import { parse as jsoncParse, ParseError } from 'jsonc-parser';

// 定义解析结果的数据类型
export type ParseResult = { value: any | null; error?: Error; finalText?: string };

// 预编译正则，避免循环中重复创建
const RE_JSON_LIKE = /^[\{\[]/;
// 仅当整段为一对引号包裹，且内部引号都是转义形式时才视为“外层引号”
const RE_OUTER_QUOTED_SAFE = /^"(?:[^"\\]|\\.)*"$/;
const RE_BS = /\\\\/g;
const RE_QUOTE = /\\"/g;
const RE_N = /\\n/g;
const RE_R = /\\r/g;
const RE_T = /\\t/g;

export function tryParseFlexible(input: string, maxDepth = 6): ParseResult {
    let s = input;
    let lastErr: Error | undefined;

    for (let i = 0; i < maxDepth; i++) {
        s = s.trim();

        if (RE_JSON_LIKE.test(s)) {
            try {
                return { value: JSON.parse(s), finalText: s };
            } catch (e) {
                lastErr = e as Error;
                // 宽松：解析带有注释/尾逗号的 JSON（仅在成功时返回）
                try {
                    const errors: ParseError[] = [];
                    const v = jsoncParse(s, errors, { allowTrailingComma: true });
                    if (errors.length === 0) {
                        return { value: v, finalText: s };
                    }
                    // 若 JSONC 也失败，继续进入“外层引号/反转义”路径
                } catch (je) {
                    // 保留最后错误信息，进入后续反转义尝试
                    lastErr = (je as Error) || lastErr;
                }
            }
        }

        // 仅在安全匹配时才移除外层引号
        if (RE_OUTER_QUOTED_SAFE.test(s)) {
            s = s.slice(1, -1);
        }

        const replaced = s.replace(RE_BS, '\\')
                          .replace(RE_QUOTE, '"')
                          .replace(RE_N, '\n')
                          .replace(RE_R, '\r')
                          .replace(RE_T, '\t');

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