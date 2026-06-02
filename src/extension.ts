import * as vscode from 'vscode';

/**
 * Positron Run Line Extension
 *
 * 在编辑器工具栏添加「运行当前行/选中代码」按钮，类似 RStudio 的 Run 按钮。
 * - 有选中文本时：运行选中的代码
 * - 无选中文本时：运行鼠标所在行的代码（含多行语句如 for/tryCatch 等）
 * - 额外提供「运行光标以上所有代码」功能
 *
 * 光标跳转策略：
 * 1. 执行代码（委托给 Positron 或 VS Code）
 * 2. 从执行后 Positron 留下的光标位置出发（对多行块 Positron 知道跳到最后）
 * 3. 跳过空行和 # 注释行
 * 4. 停在第一条有实际代码的行末尾
 */

const POSITRON_COMMAND = 'workbench.action.positronConsole.executeCode';
const VSCODE_RUN_SELECTED = 'workbench.action.terminal.runSelectedText';

// ── Positron 检测（带缓存）────────────────────────────────────────────

let _positronCommandAvailable: boolean | null = null;

async function positronCommandAvailable(): Promise<boolean> {
	if (_positronCommandAvailable !== null) {
		return _positronCommandAvailable;
	}
	try {
		const commands = await vscode.commands.getCommands(true);
		_positronCommandAvailable = commands.includes(POSITRON_COMMAND);
	} catch {
		_positronCommandAvailable = false;
	}
	return _positronCommandAvailable;
}

// ── 代码提取 ───────────────────────────────────────────────────────────

function getCodeToRun(editor: vscode.TextEditor): {
	code: string;
	line: number;
	isSelection: boolean;
} {
	const selection = editor.selection;
	if (!selection.isEmpty) {
		const code = editor.document.getText(selection);
		return { code, line: selection.start.line, isSelection: true };
	}
	const line = selection.active.line;
	const code = editor.document.lineAt(line).text;
	return { code, line, isSelection: false };
}

function getCodeAbove(editor: vscode.TextEditor): string {
	const cursorLine = editor.selection.active.line;
	const range = new vscode.Range(
		new vscode.Position(0, 0),
		new vscode.Position(cursorLine, editor.document.lineAt(cursorLine).text.length),
	);
	return editor.document.getText(range);
}

// ── 光标跳转（核心）─────────────────────────────────────────────────────

/** 判断某行是否是空行或注释行（R / Python 通用） */
function isBlankOrComment(lineText: string): boolean {
	const trimmed = lineText.trim();
	return trimmed === '' || trimmed.startsWith('#');
}

/**
 * 将光标移到目标行的末尾
 */
function moveCursorToLineEnd(editor: vscode.TextEditor, line: number): void {
	if (line >= editor.document.lineCount) {
		return;
	}
	const lineLength = editor.document.lineAt(line).text.length;
	const pos = new vscode.Position(line, lineLength);
	editor.selection = new vscode.Selection(pos, pos);
	editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.Default);
}

/**
 * 从 givenLine 开始向后找到第一条「非空且非注释」的行，移到其末尾。
 * 如果从 givenLine 到文件末尾全是空行/注释，什么都不做。
 */
function jumpToNextMeaningfulLine(editor: vscode.TextEditor, startLine: number): void {
	const total = editor.document.lineCount;
	let target = startLine;

	while (target < total && isBlankOrComment(editor.document.lineAt(target).text)) {
		target++;
	}

	if (target < total) {
		moveCursorToLineEnd(editor, target);
	}
}

// ── 代码执行 ────────────────────────────────────────────────────────────

async function runInVSCode(editor: vscode.TextEditor): Promise<void> {
	const { code, isSelection } = getCodeToRun(editor);
	if (!code.trim()) {
		return;
	}
	if (!isSelection) {
		const line = editor.selection.active.line;
		const lineRange = new vscode.Range(
			new vscode.Position(line, 0),
			new vscode.Position(line, code.length),
		);
		editor.selection = new vscode.Selection(lineRange.start, lineRange.end);
	}
	await vscode.commands.executeCommand(VSCODE_RUN_SELECTED);
}

// ── 主命令 ──────────────────────────────────────────────────────────────

/**
 * 运行当前行 / 选中代码
 *
 * 光标跳转逻辑（执行后）：
 *   1. 读取 Positron 执行后的光标位置（多行块 Positron 会跳到块末尾附近）
 *   2. 如果光标还没动（仍在 originalLine），至少前进一行
 *   3. 从当前位置出发，跳过所有空行和 # 注释行
 *   4. 停在第一条有代码的行末尾
 */
async function runCurrentLineOrSelection(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('没有打开的编辑器');
		return;
	}

	const config = vscode.workspace.getConfiguration('positronRunLine');
	const moveCursor = config.get<boolean>('moveCursorAfterRun', true);

	const { code, line: originalLine, isSelection } = getCodeToRun(editor);
	if (!code.trim()) {
		return;
	}

	// ── 执行 ──
	if (await positronCommandAvailable()) {
		await vscode.commands.executeCommand(POSITRON_COMMAND);
	} else {
		await runInVSCode(editor);
	}

	// ── 光标后处理 ──
	// 仅在「非选中模式」且「配置允许移动光标」时才调整
	if (!moveCursor || isSelection) {
		return;
	}

	setTimeout(() => {
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor || activeEditor.document !== editor.document) {
			return;
		}

		// 从 Positron 执行后留下的光标位置出发
		let cursorLine = activeEditor.selection.active.line;

		// 如果光标没动（仍在原行），至少前进一行
		if (cursorLine <= originalLine) {
			cursorLine = originalLine + 1;
		}

		// 跳过空行和注释，停在第一条有代码的行末尾
		jumpToNextMeaningfulLine(activeEditor, cursorLine);
	}, 80);
}

// ── Run Above ───────────────────────────────────────────────────────────

async function runAllAbove(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('没有打开的编辑器');
		return;
	}

	const codeAbove = getCodeAbove(editor);
	if (!codeAbove.trim()) {
		return;
	}

	const cursorLine = editor.selection.active.line;
	const lastChar = editor.document.lineAt(cursorLine).text.length;
	const range = new vscode.Range(
		new vscode.Position(0, 0),
		new vscode.Position(cursorLine, lastChar),
	);

	if (await positronCommandAvailable()) {
		editor.selection = new vscode.Selection(range.start, range.end);
		await vscode.commands.executeCommand(POSITRON_COMMAND);
	} else {
		editor.selection = new vscode.Selection(range.start, range.end);
		await vscode.commands.executeCommand(VSCODE_RUN_SELECTED);
	}

	// 取消选择，光标回到原位
	const endPos = new vscode.Position(cursorLine, lastChar);
	editor.selection = new vscode.Selection(endPos, endPos);
}

// ── 生命周期 ────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
	console.log('🚀 "Run Current Line" 扩展已激活');

	context.subscriptions.push(
		vscode.commands.registerCommand('positron-run-line.run', runCurrentLineOrSelection),
		vscode.commands.registerCommand('positron-run-line.runAbove', runAllAbove),
	);

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'positron-run-line.run';
	statusBarItem.text = '$(run) Run Line';
	statusBarItem.tooltip = '运行当前行或选中代码';
	context.subscriptions.push(statusBarItem);

	const updateBar = () => {
		const e = vscode.window.activeTextEditor;
		e && !e.document.isClosed ? statusBarItem.show() : statusBarItem.hide();
	};
	updateBar();
	vscode.window.onDidChangeActiveTextEditor(updateBar);
}

export function deactivate(): void {
	console.log('👋 "Run Current Line" 扩展已停用');
}
