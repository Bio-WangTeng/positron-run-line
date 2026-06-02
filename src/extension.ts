import * as vscode from 'vscode';

/**
 * Positron Run Line Extension
 *
 * 在编辑器工具栏添加「运行当前行/选中代码」按钮，类似 RStudio 的 Run 按钮。
 * - 有选中文本时：运行选中的代码
 * - 无选中文本时：运行鼠标所在行的代码，运行后光标移到下一行末尾
 * - 额外提供「运行光标以上所有代码」功能
 *
 * 在 Positron 中，直接调用内置的 positronConsole.executeCode 命令。
 * 在普通 VS Code 中，使用 workbench.action.terminal.runSelectedText 作为降级方案。
 */

const POSITRON_COMMAND = 'workbench.action.positronConsole.executeCode';
const VSCODE_RUN_SELECTED = 'workbench.action.terminal.runSelectedText';

/**
 * 缓存 Positron 命令可用性检查结果
 */
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

/**
 * 获取要运行的代码文本
 */
function getCodeToRun(editor: vscode.TextEditor): { code: string; line: number; isSelection: boolean } {
	const selection = editor.selection;
	if (!selection.isEmpty) {
		const code = editor.document.getText(selection);
		return { code, line: selection.start.line, isSelection: true };
	} else {
		const line = selection.active.line;
		const code = editor.document.lineAt(line).text;
		return { code, line, isSelection: false };
	}
}

/**
 * 获取光标以上的所有代码文本
 */
function getCodeAbove(editor: vscode.TextEditor): string {
	const cursorLine = editor.selection.active.line;
	const range = new vscode.Range(
		new vscode.Position(0, 0),
		new vscode.Position(cursorLine, editor.document.lineAt(cursorLine).text.length)
	);
	return editor.document.getText(range);
}

/**
 * 将光标强制移到目标行的末尾
 * @param editor  当前编辑器
 * @param line    目标行号（0-based）
 */
function moveCursorToLineEnd(editor: vscode.TextEditor, line: number): void {
	if (line >= editor.document.lineCount) {
		return;
	}
	const lineLength = editor.document.lineAt(line).text.length;
	const pos = new vscode.Position(line, lineLength);
	editor.selection = new vscode.Selection(pos, pos);
	editor.revealRange(
		new vscode.Range(pos, pos),
		vscode.TextEditorRevealType.Default
	);
}

/**
 * 在普通 VS Code 中运行代码（降级模式）
 */
async function runInVSCode(editor: vscode.TextEditor): Promise<void> {
	const { code, isSelection } = getCodeToRun(editor);
	if (!code.trim()) {
		return;
	}

	if (!isSelection) {
		// 选中整行再发送
		const line = editor.selection.active.line;
		const lineRange = new vscode.Range(
			new vscode.Position(line, 0),
			new vscode.Position(line, code.length)
		);
		editor.selection = new vscode.Selection(lineRange.start, lineRange.end);
	}

	await vscode.commands.executeCommand(VSCODE_RUN_SELECTED);
}

/**
 * 主运行命令：运行当前行或选中代码
 *
 * 核心逻辑：
 * 1. 记录运行前的光标行号
 * 2. 执行代码（委托给 Positron 或 VS Code）
 * 3. 执行后强制将光标设为「原始行号 + 1」的末尾
 *    不依赖任何外部命令的光标行为，避免跳行 bug
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

	// 执行代码
	if (await positronCommandAvailable()) {
		await vscode.commands.executeCommand(POSITRON_COMMAND);
	} else {
		await runInVSCode(editor);
	}

	// 运行后光标处理：始终强制移到下一行末尾
	// 无论 Positron/VS Code 对光标做了什么，我们都用绝对位置覆盖
	if (moveCursor && !isSelection) {
		setTimeout(() => {
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor || activeEditor.document !== editor.document) {
				return;
			}
			const targetLine = originalLine + 1;
			if (targetLine < activeEditor.document.lineCount) {
				moveCursorToLineEnd(activeEditor, targetLine);
			}
		}, 80);
	}
}

/**
 * 运行光标以上的所有代码
 */
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
		new vscode.Position(cursorLine, lastChar)
	);

	if (await positronCommandAvailable()) {
		editor.selection = new vscode.Selection(range.start, range.end);
		await vscode.commands.executeCommand(POSITRON_COMMAND);
	} else {
		editor.selection = new vscode.Selection(range.start, range.end);
		await vscode.commands.executeCommand(VSCODE_RUN_SELECTED);
	}

	// 取消选择，光标回到原位末尾
	const endPos = new vscode.Position(cursorLine, lastChar);
	editor.selection = new vscode.Selection(endPos, endPos);
}

/**
 * 扩展激活入口
 */
export function activate(context: vscode.ExtensionContext): void {
	console.log('🚀 "Run Current Line" 扩展已激活');

	const runCommand = vscode.commands.registerCommand(
		'positron-run-line.run',
		runCurrentLineOrSelection
	);

	const runAboveCommand = vscode.commands.registerCommand(
		'positron-run-line.runAbove',
		runAllAbove
	);

	context.subscriptions.push(runCommand, runAboveCommand);

	// 状态栏按钮
	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100
	);
	statusBarItem.command = 'positron-run-line.run';
	statusBarItem.text = '$(run) Run Line';
	statusBarItem.tooltip = '运行当前行或选中代码';
	context.subscriptions.push(statusBarItem);

	updateStatusBar(statusBarItem);
	vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar(statusBarItem));
}

function updateStatusBar(statusBarItem: vscode.StatusBarItem): void {
	const editor = vscode.window.activeTextEditor;
	if (editor && !editor.document.isClosed) {
		statusBarItem.show();
	} else {
		statusBarItem.hide();
	}
}

export function deactivate(): void {
	console.log('👋 "Run Current Line" 扩展已停用');
}
