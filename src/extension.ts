import * as vscode from 'vscode';

/**
 * Positron Run Line Extension
 *
 * 在编辑器工具栏添加「运行当前行/选中代码」按钮，类似 RStudio 的 Run 按钮。
 * - 有选中文本时：运行选中的代码
 * - 无选中文本时：运行鼠标所在行的代码
 * - 额外提供「运行光标以上所有代码」功能
 *
 * 在 Positron 中，直接调用内置的 positronConsole.executeCode 命令。
 * 在普通 VS Code 中，使用 workbench.action.terminal.runSelectedText 作为降级方案。
 */

const POSITRON_COMMAND = 'workbench.action.positronConsole.executeCode';
const VSCODE_RUN_SELECTED = 'workbench.action.terminal.runSelectedText';

/**
 * 缓存 Positron 命令可用性检查结果
 * 避免每次执行都调用 getCommands（有一定开销）
 */
let _positronCommandAvailable: boolean | null = null;

/**
 * 检查 Positron 命令是否可用（带缓存）
 */
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
 * 优先返回选中的文本，如果没有选中则返回当前行
 */
function getCodeToRun(editor: vscode.TextEditor): { code: string; line: number; isSelection: boolean } {
    const selection = editor.selection;

    if (!selection.isEmpty) {
        // 有选中文本
        const code = editor.document.getText(selection);
        return { code, line: selection.start.line, isSelection: true };
    } else {
        // 没有选中，取当前行
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
 * 将光标移到下一行（RStudio 行为）
 */
function moveCursorToNextLine(editor: vscode.TextEditor): void {
    const currentLine = editor.selection.active.line;
    const lastLine = editor.document.lineCount - 1;

    if (currentLine < lastLine) {
        const nextLine = currentLine + 1;
        const nextLineText = editor.document.lineAt(nextLine).text;
        // 将光标放在下一行的第一个非空字符位置
        const firstNonEmpty = nextLineText.length - nextLineText.trimStart().length;
        const newPosition = new vscode.Position(nextLine, firstNonEmpty);
        editor.selection = new vscode.Selection(newPosition, newPosition);
        // 滚动到新位置
        editor.revealRange(
            new vscode.Range(newPosition, newPosition),
            vscode.TextEditorRevealType.Default
        );
    }
}

/**
 * 在 Positron 中运行代码
 */
async function runInPositron(): Promise<void> {
    await vscode.commands.executeCommand(POSITRON_COMMAND);
}

/**
 * 在普通 VS Code 中运行代码
 * 手动处理选择/当前行逻辑，然后发送到终端
 */
async function runInVSCode(editor: vscode.TextEditor): Promise<void> {
    const { code, isSelection } = getCodeToRun(editor);

    // 跳过空行或纯注释行
    const trimmed = code.trim();
    if (!trimmed) {
        return;
    }

    if (isSelection) {
        // 保持当前选择并发送到终端
        await vscode.commands.executeCommand(VSCODE_RUN_SELECTED);
    } else {
        // 选择当前行，然后运行
        const line = editor.selection.active.line;
        const lineRange = new vscode.Range(
            new vscode.Position(line, 0),
            new vscode.Position(line, code.length)
        );
        editor.selection = new vscode.Selection(lineRange.start, lineRange.end);
        await vscode.commands.executeCommand(VSCODE_RUN_SELECTED);

        // 恢复光标到行尾
        const endPos = new vscode.Position(line, code.length);
        editor.selection = new vscode.Selection(endPos, endPos);
    }
}

/**
 * 主运行命令：运行当前行或选中代码
 */
async function runCurrentLineOrSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('没有打开的编辑器');
        return;
    }

    const config = vscode.workspace.getConfiguration('positronRunLine');
    const moveCursor = config.get<boolean>('moveCursorAfterRun', true);

    // 优先使用 Positron 命令
    if (await positronCommandAvailable()) {
        // 先检查是否为空操作
        const { code, isSelection } = getCodeToRun(editor);
        if (!code.trim()) {
            return;
        }

        await runInPositron();

        // RStudio 风格：运行后移到下一行
        if (moveCursor && !isSelection) {
            // 短暂延迟，让 Positron 先完成执行
            setTimeout(() => {
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor && activeEditor === editor) {
                    moveCursorToNextLine(activeEditor);
                }
            }, 50);
        }
    } else {
        // 降级到 VS Code 终端方式
        await runInVSCode(editor);

        if (moveCursor) {
            const { isSelection } = getCodeToRun(editor);
            if (!isSelection) {
                setTimeout(() => moveCursorToNextLine(editor), 50);
            }
        }
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

    if (await positronCommandAvailable()) {
        // 在 Positron 中，选择以上所有文本然后执行
        const cursorLine = editor.selection.active.line;
        const lastChar = editor.document.lineAt(cursorLine).text.length;
        const range = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(cursorLine, lastChar)
        );
        editor.selection = new vscode.Selection(range.start, range.end);
        await vscode.commands.executeCommand(POSITRON_COMMAND);

        // 取消选择，光标保持在原位
        const endPos = new vscode.Position(cursorLine, lastChar);
        editor.selection = new vscode.Selection(endPos, endPos);
    } else {
        // 降级到 VS Code
        const cursorLine = editor.selection.active.line;
        const lastChar = editor.document.lineAt(cursorLine).text.length;
        const range = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(cursorLine, lastChar)
        );
        editor.selection = new vscode.Selection(range.start, range.end);
        await vscode.commands.executeCommand(VSCODE_RUN_SELECTED);

        const endPos = new vscode.Position(cursorLine, lastChar);
        editor.selection = new vscode.Selection(endPos, endPos);
    }
}

/**
 * 扩展激活入口
 */
export function activate(context: vscode.ExtensionContext): void {
    console.log('🚀 "Run Current Line" 扩展已激活');

    // 注册主命令：运行当前行/选中代码
    const runCommand = vscode.commands.registerCommand(
        'positron-run-line.run',
        runCurrentLineOrSelection
    );

    // 注册辅助命令：运行光标以上的所有代码
    const runAboveCommand = vscode.commands.registerCommand(
        'positron-run-line.runAbove',
        runAllAbove
    );

    context.subscriptions.push(runCommand, runAboveCommand);

    // 状态栏提示（可选：在 Positron 中显示小提示）
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.command = 'positron-run-line.run';
    statusBarItem.text = '$(run) Run Line';
    statusBarItem.tooltip = '运行当前行或选中代码';
    context.subscriptions.push(statusBarItem);

    // 根据活跃语言决定是否显示状态栏按钮
    updateStatusBar(statusBarItem);
    vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar(statusBarItem));
}

/**
 * 更新状态栏按钮可见性
 */
function updateStatusBar(statusBarItem: vscode.StatusBarItem): void {
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.document.isClosed) {
        statusBarItem.show();
    } else {
        statusBarItem.hide();
    }
}

/**
 * 扩展停用
 */
export function deactivate(): void {
    console.log('👋 "Run Current Line" 扩展已停用');
}
