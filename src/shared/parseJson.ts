import { parse as jsoncParse, ParseError } from 'jsonc-parser';

// 定义解析结果的数据类型
export type ParseResult = { value: any | null; error?: Error; finalText?: string };

// 解析json字符串的核心方法
export function tryParseFlexible(input: string, maxDepth = 6): ParseResult {
    let s = input;
    let lastErr: Error | undefined;

    for (let i = 0; i < maxDepth; i++) {
        s = s.trim();

        // 优先严格 JSON.parse
        if (/^[\{\[]/.test(s)) {
            try {
                return { value: JSON.parse(s), finalText: s };
            } catch (e) {
                lastErr = e as Error;
                // 宽松：解析带有注释的 JSON
                try {
                    const errors: ParseError[] = [];
                    const v = jsoncParse(s, errors, { allowTrailingComma: true });
                    if (errors.length === 0) return { value: v, finalText: s };
                    lastErr = new Error('jsonc-parser errors: ' + JSON.stringify(errors.slice(0, 3)));
                } catch {
                    // 继续走转义处理
                }
            }
        }

        // 去掉外层引号（若整段是被字符串包裹）
        if (/^"(.*)"$/.test(s)) {
            s = s.slice(1, -1);
        }

        // 常见反转义（一次替换）
        const replaced = s.replace(/\\\\/g, '\\')
                          .replace(/\\"/g, '"')
                          .replace(/\\n/g, '\n')
                          .replace(/\\r/g, '\r')
                          .replace(/\\t/g, '\t');

        if (replaced === s) break;
        s = replaced;
    }

    // 最后尝试一次：先 JSON，再 JSONC
    try {
        return { value: JSON.parse(s), finalText: s };
    } catch (e) {
        lastErr = e as Error;
        try {
            const errors: ParseError[] = [];
            const v = jsoncParse(s, errors, { allowTrailingComma: true });
            if (errors.length === 0) return { value: v, finalText: s };
            return { value: null, error: new Error('jsonc-parser errors: ' + JSON.stringify(errors.slice(0, 5))), finalText: s };
        } catch (je) {
            return { value: null, error: (je as Error) ?? lastErr, finalText: s };
        }
    }
}