/**
 * 解析PHP数组字符串为JavaScript对象
 * 支持格式如: array ( 'key' => 'value', 'nested' => array ( ... ) )
 */
export function parsePhpArray(phpStr: string): any {
    // let trimmed = phpStr.trim();
    // const startStr = trimmed.slice(0, 5).toLowerCase();
    // if (startStr != "array") {
    //     throw new Error('Invalid PHP array format');
    // }

    // 删除第一个array前面的内容，以及最后一个 ) 后面的内容
    const match = phpStr.match(/array[\s\S]*\)/);
    if (match) {
        phpStr = match[0];
    }

    const inner = phpStr.slice(8, -1).trim();
    return parseObject(inner);
}

function parseObject(str: string): any {
    const result: any = {};
    let i = 0;

    while (i < str.length) {
        // 跳过空白和换行
        while (i < str.length && /\s/.test(str[i])) i++;
        if (i >= str.length) break;

        // 解析键
        const key = parseKey(str, i);
        i = key.end;

        // 跳过 '=>'
        while (i < str.length && /\s/.test(str[i])) i++;
        if (str.slice(i, i + 2) !== '=>') throw new Error(`Expected '=>' at position ${i}`);
        i += 2;
        while (i < str.length && /\s/.test(str[i])) i++;

        // 解析值
        const value = parseValue(str, i);
        i = value.end;

        result[key.value] = value.value;

        // 跳过逗号
        while (i < str.length && /\s/.test(str[i])) i++;
        if (i < str.length && str[i] === ',') i++;
    }

    return result;
}

function parseKey(str: string, start: number): { value: string | number; end: number } {
    let i = start;
    if (str[i] === "'") {
        i++;
        let key = '';
        while (i < str.length && str[i] !== "'") {
            if (str[i] === '\\') {
                i++;
                if (i < str.length) key += str[i];
            } else {
                key += str[i];
            }
            i++;
        }
        if (str[i] !== "'") throw new Error(`Unterminated string key at position ${start}`);
        i++;
        return { value: key, end: i };
    } else if (/\d/.test(str[i])) {
        let num = '';
        while (i < str.length && /\d/.test(str[i])) {
            num += str[i];
            i++;
        }
        return { value: parseInt(num, 10), end: i };
    }
    throw new Error(`Invalid key at position ${start}`);
}

function parseValue(str: string, start: number): { value: any; end: number } {
    let i = start;
    if (str[i] === "'") {
        return parseString(str, i);
    } else if (str.slice(i, i + 5) === 'array') {
        return parseArray(str, i);
    } else if (str.slice(i, i + 4) === 'true') {
        return { value: true, end: i + 4 };
    } else if (str.slice(i, i + 5) === 'false') {
        return { value: false, end: i + 5 };
    } else if (str.slice(i, i + 4) === 'null') {
        return { value: null, end: i + 4 };
    } else if (/\d/.test(str[i]) || str[i] === '-') {
        let num = '';
        while (i < str.length && /[\d\.\-]/.test(str[i])) {
            num += str[i];
            i++;
        }
        return { value: parseFloat(num), end: i };
    }
    throw new Error(`Invalid value at position ${start}`);
}

function parseString(str: string, start: number): { value: string; end: number } {
    let i = start + 1; // 跳过开头的 '
    let value = '';
    while (i < str.length && str[i] !== "'") {
        if (str[i] === '\\') {
            i++;
            if (i < str.length) {
                if (str[i] === "'") value += "'";
                else if (str[i] === '\\') value += '\\';
                else value += '\\' + str[i];
            }
        } else {
            value += str[i];
        }
        i++;
    }
    if (str[i] !== "'") throw new Error(`Unterminated string at position ${start}`);
    i++;
    return { value, end: i };
}

function parseArray(str: string, start: number): { value: any; end: number } {
    let i = start;
    if (str.slice(i, i + 6) !== 'array ') throw new Error(`Expected 'array' at position ${i}`);
    i += 6;
    while (i < str.length && /\s/.test(str[i])) i++;
    if (str[i] !== '(') throw new Error(`Expected '(' after 'array' at position ${i}`);
    i++; // 跳过 (

    // 找到匹配的 )
    let depth = 1;
    let startInner = i;
    while (i < str.length && depth > 0) {
        if (str[i] === '(') depth++;
        else if (str[i] === ')') depth--;
        i++;
    }
    if (depth !== 0) throw new Error(`Unmatched parentheses in array at position ${start}`);
    
    // 提取内部内容并解析
    const inner = str.slice(startInner, i - 1); // 从 startInner 到 ) 之前
    const value = parseObject(inner);
    return { value, end: i }; // i 现在指向 ) 之后
}