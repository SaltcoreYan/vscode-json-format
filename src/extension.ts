import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { deepDecodeUnicode } from './shared/decode';
import { type ParseResult, tryParseFlexible } from "./shared/parseJson";
import { parsePhpArray } from './shared/phpArrayParser';

// 预编译正则，避免重复创建
const RE_ERR_POS = /position\s+(\d+)/i;
const RE_ERR_AT_POS = /at position\s+(\d+)/i;
const RE_LF = /\n/g;

// worker 执行解析的超时时间
const WORKER_PARSE_TIMEOUT_MS = 2000;
// 64KB 内先走主线程快速路径
const SMALL_INPUT_THRESHOLD = 64 * 1024;

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
        const lastLineIndex = Math.min(doc.lineCount - 1, 200);
        const end = lastLineIndex >= 0 ? doc.lineAt(lastLineIndex).range.end : new vscode.Position(0, 0);
        const sample = doc.getText(new vscode.Range(new vscode.Position(0, 0), end));
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
        // 不再手动处理 BOM/CRLF，仅做 trim
        text = text.trim();

        // 新增：检测并解析PHP数组
        let parseResult: ParseResult | null = null;
        const trimmedText = text.trim();
        const startStr = trimmedText.slice(0, 5).toLowerCase();
        if (startStr == "array") {
            try {
                const parsedObj = parsePhpArray(trimmedText);
                parseResult = { value: parsedObj, finalText: text };
            } catch (error) {
                // 解析失败，回退到JSON解析
                vscode.window.showWarningMessage(`PHP数组解析失败：${(error as Error).message}，尝试作为JSON解析。`);
            }
        }

        // 如果未解析为PHP数组，继续原有JSON解析逻辑
        if (!parseResult) {
            // 读取配置与输入大小
            const config = vscode.workspace.getConfiguration('json-format');
            const maxInputMB = Number(config.get('maxInputSizeMB', 2));
            const MAX_INPUT_BYTES = (isNaN(maxInputMB) || maxInputMB <= 0) ? 0 : Math.max(0, Math.floor(maxInputMB)) * 1024 * 1024;

            const sizeBytes = Buffer.byteLength(text, 'utf8');
            if (MAX_INPUT_BYTES > 0 && sizeBytes > MAX_INPUT_BYTES) {
                vscode.window.showErrorMessage(`输入过大：${Math.round(sizeBytes / 1024)} KB，超过限制 ${Math.round(MAX_INPUT_BYTES / 1024)} KB，已取消操作。`);
                return;
            }

            // 快速路径：小输入优先在主线程解析（最多尝试 3 层反转义）
            let quickParseResult: ParseResult | null = null;
            if (sizeBytes <= SMALL_INPUT_THRESHOLD) {
                const quick = tryParseFlexible(text, 3);
                if (quick.value !== null) quickParseResult = quick;
            }

            // 如快速路径失败或输入较大，使用 worker
            if (!quickParseResult) {
                async function parseWithWorker(input: string, token?: vscode.CancellationToken): Promise<ParseResult> {
                    const primary = path.join(__dirname, 'jsonParserWorker.js');
                    const fallback = path.join(context.extensionPath, 'out', 'jsonParserWorker.js');
                    const workerPath = fs.existsSync(primary) ? primary : fallback;

                    if (!fs.existsSync(workerPath)) {
                        return { value: null, error: new Error('找不到 out/jsonParserWorker.js（请运行 npm run compile）'), finalText: input };
                    }

                    try {
                        const worker = new Worker(workerPath);
                        let finished = false;

                        return await new Promise<ParseResult>((resolve) => {
                            const cleanup = () => {
                                try { worker.terminate(); } catch {  }
                            };

                            // 支持用户取消
                            const onCancel = () => {
                                if (finished) return;
                                finished = true;
                                cleanup();
                                resolve({ value: null, error: new Error('已取消'), finalText: input });
                            };
                            const cancelSub = token?.onCancellationRequested(onCancel);

                            const timer = setTimeout(() => {
                                if (finished) return;
                                finished = true;
                                cleanup();
                                cancelSub?.dispose(); // 释放订阅
                                resolve({ value: null, error: new Error('解析超时'), finalText: input });
                            }, WORKER_PARSE_TIMEOUT_MS);

                            worker.on('message', (msg: any) => {
                                if (finished) return;
                                finished = true;
                                clearTimeout(timer);
                                cleanup();
                                cancelSub?.dispose(); // 释放订阅
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
                                cleanup();
                                cancelSub?.dispose(); // 释放订阅
                                resolve({ value: null, error: err as Error, finalText: input });
                            });

                            worker.postMessage(input);
                        });
                    } catch (e) {
                        // 回退：主线程解析（带超时保护）
                        return new Promise<ParseResult>(resolve => {
                            const t = setTimeout(() => {
                                resolve({ value: null, error: new Error('解析超时（回退）'), finalText: input });
                            }, WORKER_PARSE_TIMEOUT_MS);
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

                parseResult = await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: '解析 JSON...', cancellable: true },
                    async (_progress, token) => {
                        await new Promise(r => setTimeout(r, 0));
                        return parseWithWorker(text, token);
                    }
                );
            }

            if (!parseResult || parseResult.value === null) {
                // 从错误消息中提取位置并计算行列，给出片段预览
                const pr = parseResult ?? { value: null, error: new Error('无法解析为 JSON'), finalText: text };
                const errMsg = pr.error?.message || '无法解析为 JSON';

                let detail = errMsg;
                const finalText = pr.finalText ?? text;

                if ((errMsg || '').toLowerCase().includes('超时')) {
                    detail = '解析超时（输入可能过大或存在复杂多重转义），可尝试选中更小范围再试。';
                } else {
                    const m = (RE_ERR_POS.exec(errMsg) || RE_ERR_AT_POS.exec(errMsg));
                    if (m && m[1]) {
                        const idx = Math.max(0, parseInt(m[1], 10));
                        const before = finalText.slice(0, idx);
                        const lines = before.split(/\n/);
                        const line = lines.length;
                        const col = (lines[lines.length - 1] || '').length + 1;
                        const previewStart = Math.max(0, idx - 30);
                        const previewEnd = Math.min(finalText.length, idx + 30);
                        const preview = finalText.slice(previewStart, previewEnd).replace(RE_LF, '\\n');
                        detail = `${errMsg}（行 ${line} 列 ${col}，片段: ...${preview}...）`;
                    } else {
                        const preview = (finalText || text).slice(0, 200).replace(RE_LF, '\\n');
                        detail = `${errMsg}（预览前200字符: ${preview}${(finalText || text).length > 200 ? '...' : ''}）`;
                    }
                }
                vscode.window.showErrorMessage(`JSON 解析失败：${detail}`);
                return;
            }
        }

        // 读取编辑器缩进/EOL
        const editorOpts = editor.options;
        const useSpaces = editorOpts.insertSpaces === true;
        const tabSize = Number(editorOpts.tabSize) > 0 ? Number(editorOpts.tabSize) : 4;
        const indent: string | number = useSpaces ? tabSize : '\t';
        const eolStr = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

        // 仅在主线程做一次 Unicode 还原
        const cfg = vscode.workspace.getConfiguration('json-format');
        const enableDecode = cfg.get<boolean>('decodeUnicode', true);
        const outputObj = enableDecode ? deepDecodeUnicode(parseResult.value) : parseResult.value;

        // 用编辑器缩进格式化
        let formatted = JSON.stringify(outputObj, null, indent);
        if (eolStr === '\r\n') {
            formatted = formatted.replace(RE_LF, '\r\n');
        }

        // 若需要按设置补尾行换行（可选）
        const insertFinalNewline = vscode.workspace.getConfiguration('files').get<boolean>('insertFinalNewline', false);
        if (insertFinalNewline && !formatted.endsWith(eolStr)) {
            formatted += eolStr;
        }

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
