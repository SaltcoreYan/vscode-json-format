// 处理字符串的unicode编码
export function decodeUnicodeEscapes(input: string): string {
    if (!input || typeof input !== 'string') return input;

    // 代理对：\uD83D\uDE00
    input = input.replace(/\\u(d[89ab][0-9a-f]{2})\\u(d[cdef][0-9a-f]{2})/gi, (_m, hi, lo) => {
        const high = parseInt(hi, 16);
        const low = parseInt(lo, 16);
        const cp = (high - 0xD800) * 0x400 + (low - 0xDC00) + 0x10000;
        return String.fromCodePoint(cp);
    });

    input = input.replace(/\\u([0-9a-f]{4})/gi, (_m, g1) => String.fromCharCode(parseInt(g1, 16)));

    input = input.replace(/\\x([0-9a-f]{2})/gi, (_m, g1) => String.fromCharCode(parseInt(g1, 16)));

    // 常见控制字符
    input = input
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\b/g, '\b')
        .replace(/\\f/g, '\f')
        .replace(/\\\//g, '/')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');

    return input;
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