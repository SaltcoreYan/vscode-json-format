// 处理字符串的unicode编码
export function decodeUnicodeEscapes(input: string): string {
    if (!input || typeof input !== 'string') return input;

    // 多轮解码，处理多重转义
    let prev = '';
    let cur = input;
    for (let i = 0; i < 4 && cur !== prev; i++) {
        prev = cur;

        // 先还原常见控制字符与反斜杠/引号/斜杠
        cur = cur
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\b/g, '\b')
            .replace(/\\f/g, '\f')
            .replace(/\\\//g, '/')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');

        // 代理对：\uD83D\uDE00
        cur = cur.replace(/\\u(d[89ab][0-9a-f]{2})\\u(d[cdef][0-9a-f]{2})/gi, (_m, hi, lo) => {
            const high = parseInt(hi, 16);
            const low = parseInt(lo, 16);
            const cp = (high - 0xD800) * 0x400 + (low - 0xDC00) + 0x10000;
            return String.fromCodePoint(cp);
        });

        // 普通 \uXXXX 与 \xHH
        cur = cur
            .replace(/\\u([0-9a-f]{4})/gi, (_m, g1) => String.fromCharCode(parseInt(g1, 16)))
            .replace(/\\x([0-9a-f]{2})/gi, (_m, g1) => String.fromCharCode(parseInt(g1, 16)));
    }
    return cur;
}

export function deepDecodeUnicode(value: any): any {
    if (typeof value === 'string') return decodeUnicodeEscapes(value);
    if (Array.isArray(value)) return value.map(deepDecodeUnicode);
    if (value && typeof value === 'object') {
        const out: any = {};
        for (const [k, v] of Object.entries(value)) out[k] = deepDecodeUnicode(v);
        return out;
    }
    return value;
}