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

        let parsed: any;
        // 尝试多种方式解析可能被转义的 JSON 字符串
        let s = text;
        let ok = false;
        for (let i = 0; i < 4; i++) {
            try {
                parsed = JSON.parse(s);
                // 如果解析得到的是字符串并且看起来像 JSON（以 { 或 [ 开头），继续解析一次
                if (typeof parsed === 'string' && /^\s*[\{\[]/.test(parsed)) {
                    s = parsed;
                    ok = false;
                    continue;
                }
                ok = true;
                break;
            } catch (e) {
                // 尝试去掉外层引号
                if (/^".*"$/.test(s)) {
                    s = s.slice(1, -1);
                }
                // 反转义常见的转义序列（将双反斜杠变为单反斜杠，\" => " 等）
                s = s.replace(/\\\\/g, '\\')
                     .replace(/\\"/g, '"')
                     .replace(/\\n/g, '\n')
                     .replace(/\\r/g, '\r')
                     .replace(/\\t/g, '\t');
                // 继续下一轮尝试
            }
        }

        if (!ok) {
            vscode.window.showErrorMessage('选中的内容或文件不是合法的 JSON。');
            return;
        }

        const formatted = JSON.stringify(parsed, null, 4);

        await editor.edit(editBuilder => {
            if (hasSelection) {
                editBuilder.replace(selection, formatted);
            } else {
                const firstLine = doc.lineAt(0);
                const lastLine = doc.lineAt(doc.lineCount - 1);
                const fullRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
                editBuilder.replace(fullRange, formatted);
            }
        });

        vscode.window.showInformationMessage('JSON 格式化完成。');
    });

    context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
