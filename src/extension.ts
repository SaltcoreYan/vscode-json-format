import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "json-format" is now active!');

    const disposable = vscode.commands.registerCommand('json-format.jsonFormat', async () => {
        // 获取打开的编辑器页面
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有打开的活动编辑器。');
            return;
        }

        // 这是整个页面的内容
        const doc = editor.document;
        // 这是被选中的内容
        const selection = editor.selection;
        const hasSelection = !selection.isEmpty;

        // 如果有选中，就获取选中的内容；如果没有选中，就获取所有内容
        let text = hasSelection ? doc.getText(selection) : doc.getText();
        if (!text || text.trim().length === 0) {
            vscode.window.showInformationMessage('当前选中内容或文件为空。');
            return;
        }
        text = text.trim();

        // 优化解析器：优先直接解析，看起来像 JSON 直接 parse，否则做有限次反转义尝试
        function tryParseFlexible(input: string, maxDepth = 6): any | null {
            let s = input;
            for (let i = 0; i < maxDepth; i++) {
                s = s.trim();
                // 如果以 { 或 [ 开头，直接尝试解析（常见情况优先）
                if (/^[\{\[]/.test(s)) {
                    try {
                        return JSON.parse(s);
                    } catch {
                        // 解析失败则继续尝试反转义
                    }
                }
                // 去掉外层引号
                if (/^"(.*)"$/.test(s)) {
                    s = s.slice(1, -1);
                }
                // 常见反转义（一次性替换，避免大量中间字符串）
                const replaced = s.replace(/\\\\/g, '\\')
                                  .replace(/\\"/g, '"')
                                  .replace(/\\n/g, '\n')
                                  .replace(/\\r/g, '\r')
                                  .replace(/\\t/g, '\t');
                if (replaced === s) {
                    // 无更多变化，跳出
                    break;
                }
                s = replaced;
            }
            try {
                return JSON.parse(s);
            } catch {
                return null;
            }
        }

        const parsed = tryParseFlexible(text, 6);
        if (parsed === null) {
            vscode.window.showErrorMessage('选中的内容或文件不是合法的 JSON。');
            return;
        }

        const formatted = JSON.stringify(parsed, null, 4);

        // 比较规范化后再决定是否写入，避免不必要的编辑操作
        const normalize = (str: string) => str.replace(/\r\n/g, '\n').trim();
        if (normalize(formatted) === normalize(text)) {
            vscode.window.showInformationMessage('已是格式化的 JSON，未做修改。');
            return;
        }

        try {
            await editor.edit(editBuilder => {
                if (hasSelection) {
                    editBuilder.replace(selection, formatted);
                } else {
                    const firstLine = doc.lineAt(0);
                    const lastLine = doc.lineAt(doc.lineCount - 1);
                    const fullRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
                    editBuilder.replace(fullRange, formatted);
                }
            }, { undoStopBefore: true, undoStopAfter: true });
            vscode.window.showInformationMessage('JSON 格式化完成。');
        } catch (e) {
            vscode.window.showErrorMessage('写入文档失败：' + (e && (e as Error).message ? (e as Error).message : String(e)));
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
