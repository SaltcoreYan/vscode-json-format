const { parentPort } = require('worker_threads');

parentPort.on('message', (input) => {
    try {
        let s = input;
        for (let i = 0; i < 6; i++) {
            s = (s || '').trim();
            if (/^[\{\[]/.test(s)) {
                try {
                    const v = JSON.parse(s);
                    parentPort.postMessage({ value: v });
                    return;
                } catch (e) {
                    
                }
            }
            if (/^"(.*)"$/.test(s)) s = s.slice(1, -1);
            const replaced = s.replace(/\\\\/g, '\\')
                              .replace(/\\"/g, '"')
                              .replace(/\\n/g, '\n')
                              .replace(/\\r/g, '\r')
                              .replace(/\\t/g, '\t');
            if (replaced === s) break;
            s = replaced;
        }

        const finalValue = JSON.parse(s);
        parentPort.postMessage({ value: finalValue, finalText: s });
    } catch (err) {
        parentPort.postMessage({
            error: err && err.message ? err.message : String(err),
            finalText: (typeof input === 'string' ? input : '').slice(0, 2000)
        });
    }
});