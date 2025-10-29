# json-format

Format and normalize JSON or JSON-like strings in the editor.

Features:
- Flexible parsing: raw JSON, JSON in escaped strings, multi-layer escapes.
- Unicode unescaping: restore \uXXXX and surrogate pairs.
- JSONC tolerant (optional in parser): comments and trailing commas.
- Fast path for small inputs; worker offloading for large/complex cases.
- Honors editor indentation (tabSize/insertSpaces) and EOL.
- Size limit to avoid blocking (configurable).

Command:
- json-format: 格式化 JSON (Default: Ctrl+Alt+J)

Settings:
- json-format.maxInputSizeMB (number, default 2): Max input size in MB. 0 = unlimited.
- json-format.decodeUnicode (boolean, default true): Whether to unescape Unicode sequences.

Usage:
- Select a region or run the command on the whole file. The extension parses, decodes, and formats the JSON.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
