import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { deepDecodeUnicode } from './shared/decode';
import { type ParseResult, tryParseFlexible } from "./shared/parseJson";

// worker 执行解析的超时时间
const WORKER_PARSE_TIMEOUT_MS = 2000

export function activate(context: vscode.ExtensionContext) {
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

        // 读取用户配置的最大输入大小（MB），默认 2 MB
        const config = vscode.workspace.getConfiguration('json-format');
        const maxInputMB = Number(config.get('maxInputSizeMB', 2));
        // 有效整数并转换为字节；若为 0 则表示不限制
        const MAX_INPUT_BYTES = (isNaN(maxInputMB) || maxInputMB <= 0) ? 0 : Math.max(0, Math.floor(maxInputMB)) * 1024 * 1024;

        // 输入大小限制，避免超大内容阻塞或 OOM（若 MAX_INPUT_BYTES 为 0 则不限制）
        if (MAX_INPUT_BYTES > 0) {
            const byteLen = Buffer.byteLength(text, 'utf8');
            if (byteLen > MAX_INPUT_BYTES) {
                vscode.window.showErrorMessage(`输入过大：${Math.round(byteLen / 1024)} KB，超过限制 ${Math.round(MAX_INPUT_BYTES / 1024)} KB，已取消操作。`);
                return;
            }
        }

        // 使用 worker 解析（优先使用 out 下的编译产物，开发时回退到 src）
        async function parseWithWorker(input: string): Promise<ParseResult> {
            const candidates = [
                path.join(__dirname, 'jsonParserWorker.js'),
                path.join(context.extensionPath, 'out', 'jsonParserWorker.js'),      // 备用 out 路径
                path.join(context.extensionPath, 'src', 'jsonParserWorker.js'),      // 开发时直接用 src（未编译）
                path.join(__dirname, 'jsonParserWorker.ts')
            ];
            const workerPath = candidates.find(p => fs.existsSync(p));
            if (!workerPath) {
                return { value: null, error: new Error('找不到 jsonParserWorker（请运行 npm run compile）'), finalText: input };
            }

            try {
                const worker = new Worker(workerPath);
                let finished = false;

                return await new Promise<ParseResult>((resolve) => {
                    const timer = setTimeout(() => {
                        if (finished) return;
                        finished = true;

                        // 终止 worker
                        try { worker.terminate(); } catch {  }

                        resolve({ value: null, error: new Error('解析超时'), finalText: input });
                    }, WORKER_PARSE_TIMEOUT_MS);

                    worker.on('message', (msg: any) => {
                        if (finished) return;
                        finished = true;
                        clearTimeout(timer);

                        // 终止 worker
                        try { worker.terminate(); } catch {  }

                        if (msg && msg.value !== undefined) {
                            resolve({ value: msg.value, finalText: msg.finalText ?? input });
                        } else {
                            resolve({ value: null, error: new Error(msg && msg.error ? msg.error : '解析失败'), finalText: msg && msg.finalText ? msg.finalText : input });
                        }
                    });

                    worker.on('error', (err) => {
                        if (finished) return;
                        finished = true;
                        clearTimeout(timer);

                        try { worker.terminate(); } catch {  }
                        resolve({ value: null, error: err as Error, finalText: input });
                    });

                    // 发送输入到 worker（字符串）
                    worker.postMessage(input);
                });
            } catch (e) {
                // 在主线程上解析并加超时保护（不会完全中止，但避免等待无限期）
                return new Promise<ParseResult>(resolve => {
                    const t = setTimeout(() => {
                        resolve({ value: null, error: new Error('解析超时（回退）'), finalText: input });
                    }, WORKER_PARSE_TIMEOUT_MS);

                    // 如果worker中解析json失败，就回到主线程解析
                    Promise.resolve().then(() => {
                        try {
                            const r = tryParseFlexible(input, 6);
                            clearTimeout(t);
                            resolve(r);
                        } catch (err) {
                            clearTimeout(t);
                            resolve({ value: null, error: err as Error, finalText: input });
                        }
                    });
                });
            }
        }

        // 在带进度的异步任务里做解析，避免主线程长时间阻塞
        const parseResult = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: '解析 JSON...', cancellable: false },
            async () => {
                await new Promise(resolve => setTimeout(resolve, 0));
                return parseWithWorker(text);
            }
        );

        if (parseResult.value === null) {
            // 从错误消息中提取位置并计算行列，给出片段预览
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
        const decoded = deepDecodeUnicode(parsed); // 还原 Unicode

        const formatted = JSON.stringify(decoded, null, 4); // 用还原后的结果输出

        // 避免不必要的编辑操作
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
