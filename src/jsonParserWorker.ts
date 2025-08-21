import { parentPort } from 'worker_threads';
import { tryParseFlexible } from './shared/parseJson';

//  worker 里解析json
parentPort?.on('message', (input: string) => {
    try {
        const result = tryParseFlexible(input, 6);
        if (result.value !== null) {
            parentPort!.postMessage({
                value: result.value,           // 不再 deepDecodeUnicode
                finalText: result.finalText ?? input
            });
        } else {
            parentPort!.postMessage({
                error: result.error?.message || '解析失败',
                finalText: result.finalText ?? input
            });
        }
    } catch (err: any) {
        parentPort!.postMessage({
            error: err?.message || String(err),
            finalText: typeof input === 'string' ? input.slice(0, 2000) : ''
        });
    }
});