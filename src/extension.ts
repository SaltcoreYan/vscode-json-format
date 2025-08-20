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
        // 避免在大型二进制/非文本文件上运行（通过检测 NUL 字符）
        const sample = doc.getText(new vscode.Range(0, 0, Math.min(10, doc.lineCount - 1), 0));
        if (sample.indexOf('\u0000') !== -1) {
            vscode.window.showErrorMessage('该文件似乎不是文本文件，已取消操作。');
            return;
        }

        // 这是被选中的内容
        const selection = editor.selection;
        const hasSelection = !selection.isEmpty;

        // 如果有选中，就获取选中的内容；如果没有选中，就获取所有内容
        let text = hasSelection ? doc.getText(selection) : doc.getText();
        if (!text || text.trim().length === 0) {
            vscode.window.showInformationMessage('当前选中内容或文件为空。');
            return;
        }

        // 处理 BOM 并统一换行（CRLF -> LF）
        text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();

        // 输入大小限制，避免超大内容阻塞或 OOM
        const MAX_INPUT_BYTES = 2 * 1024 * 1024; // 2MB
        const byteLen = Buffer.byteLength(text, 'utf8');
        if (byteLen > MAX_INPUT_BYTES) {
            vscode.window.showErrorMessage(`输入过大：${Math.round(byteLen / 1024)} KB，超过限制 ${Math.round(MAX_INPUT_BYTES / 1024)} KB，已取消操作。`);
            return;
        }

        type ParseResult = { value: any | null; error?: Error; finalText?: string };

        // 优化解析器：尽量少创建中间字符串，返回最终尝试解析的文本以便报错定位
        function tryParseFlexible(input: string, maxDepth = 6): ParseResult {
            let s = input;
            let lastErr: Error | undefined;
            for (let i = 0; i < maxDepth; i++) {
                s = s.trim();
                // 直接尝试解析对象/数组开头的情况
                if (/^[\{\[]/.test(s)) {
                    try {
                        return { value: JSON.parse(s), finalText: s };
                    } catch (e) {
                        lastErr = e as Error;
                        // 继续尝试反转义
                    }
                }
                // 去掉外层引号
                if (/^"(.*)"$/.test(s)) {
                    s = s.slice(1, -1);
                }
                // 常见反转义（一次替换）
                const replaced = s.replace(/\\\\/g, '\\')
                    .replace(/\\"/g, '"')
                    .replace(/\\n/g, '\n')
                    .replace(/\\r/g, '\r')
                    .replace(/\\t/g, '\t');
                if (replaced === s) {
                    break;
                }
                s = replaced;
            }
            try {
                return { value: JSON.parse(s), finalText: s };
            } catch (e) {
                lastErr = e as Error;
                return { value: null, error: lastErr, finalText: s };
            }
        }

        // 封装超时：如果解析超时返回带 error 的 ParseResult
        const PARSE_TIMEOUT_MS = 2000;
        async function parseWithTimeout(input: string): Promise<ParseResult> {
            return new Promise<ParseResult>(resolve => {
                // 解析在 next tick 内执行（减少同步阻塞）
                const doParse = () => {
                    try {
                        const r = tryParseFlexible(input, 6);
                        resolve(r);
                    } catch (e) {
                        resolve({ value: null, error: e as Error, finalText: input });
                    }
                };
                const t = setTimeout(() => {
                    resolve({ value: null, error: new Error('解析超时'), finalText: input });
                }, PARSE_TIMEOUT_MS);
                // 执行解析并清理超时定时器
                Promise.resolve().then(() => {
                    doParse();
                    clearTimeout(t);
                });
            });
        }

        // 在带进度的异步任务里做解析，避免主线程长时间阻塞
        const parseResult = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: '解析 JSON...', cancellable: false },
            async () => {
                // 让出一次事件循环，改善 UI 响应（对极端情况有帮助）
                await new Promise(resolve => setTimeout(resolve, 0));
                return parseWithTimeout(text);
            }
        );

        if (parseResult.value === null) {
            // 更友好且尽可能精确的错误信息：尝试从错误消息中提取位置并计算行列，给出片段预览
            const errMsg = parseResult.error?.message || '无法解析为 JSON';
            let detail = errMsg;
            const finalText = parseResult.finalText ?? text;
            if ((errMsg || '').toLowerCase().includes('超时')) {
                detail = '解析超时（输入可能过大或存在复杂多重转义），可尝试选中更小范围再试。';
            } else {
                const m = (errMsg || '').match(/position\s+(\d+)/i) || (errMsg || '').match(/at position\s+(\d+)/i);
                if (m && m[1]) {
                    const idx = Math.max(0, parseInt(m[1], 10));
                    const before = finalText.slice(0, idx);
                    const lines = before.split(/\n/);
                    const line = lines.length;
                    const col = (lines[lines.length - 1] || '').length + 1;
                    const previewStart = Math.max(0, idx - 30);
                    const previewEnd = Math.min(finalText.length, idx + 30);
                    const preview = finalText.slice(previewStart, previewEnd).replace(/\n/g, '\\n');
                    detail = `${errMsg}（行 ${line} 列 ${col}，片段: ...${preview}...）`;
                } else {
                    const preview = (finalText || text).slice(0, 200).replace(/\n/g, '\\n');
                    detail = `${errMsg}（预览前200字符: ${preview}${(finalText || text).length > 200 ? '...' : ''}）`;
                }
            }
            vscode.window.showErrorMessage(`JSON 解析失败：${detail}`);
            return;
        }

        const parsed = parseResult.value;
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
