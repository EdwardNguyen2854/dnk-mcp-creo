# Third-party attribution

DNK MCP Creo is licensed under the Apache License 2.0. It depends on the
following third-party components. Their licenses apply to those components, not
to the project as a whole.

## Direct runtime dependencies

| Component | Version | License | Copyright / project |
|---|---|---|---|
| [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) | `^1.30.1` | MIT | Model Context Protocol contributors |
| [`zod`](https://github.com/colinhacks/zod) | `^4.6.7` | MIT | Colin McDonnell and contributors |

## Direct development dependencies

| Component | Version | License | Copyright / project |
|---|---|---|---|
| [`typescript`](https://github.com/microsoft/TypeScript) | `^5.7.0` | Apache-2.0 | Microsoft Corporation |
| [`vitest`](https://github.com/vitest-dev/vitest) | `^5.1.0` | MIT | Vitest contributors |
| [`@types/node`](https://github.com/DefinitelyTyped/DefinitelyTyped) | `^22.10.0` | MIT | DefinitelyTyped contributors |

Transitive npm dependencies are pinned in `package-lock.json`. Run
`npx license-checker --summary` to list their licenses.

## Vendored source

### nlohmann/json

- File: `native/otk-bridge/third_party/nlohmann/json.hpp`
- Copyright: 2013-2023 Niels Lohmann
- License: MIT
- Project: <https://github.com/nlohmann/json>

```text
MIT License

Copyright (c) 2013-2023 Niels Lohmann

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Not distributed

The following are required to build or run the project but are **not** part of
this repository and are not covered by its license:

- PTC Creo Parametric
- PTC Creo Pro/TOOLKIT SDK
- PTC Creo Object TOOLKIT (OTK) C++ SDK
- PTC documentation

PTC, Creo, Creo Parametric, Pro/ENGINEER, Pro/TOOLKIT, and Object TOOLKIT are
trademarks or registered trademarks of PTC Inc. or its subsidiaries. This
project is independent and is not affiliated with or endorsed by PTC.

## Documentation references

`docs/research/` contains original summaries of publicly available standards
catalog data and of the APIs exposed by the installed Creo SDK. It does not
redistribute PTC documentation. Standards text is not reproduced; only public
catalog metadata (standard numbers, titles, and lifecycle stages) is cited.
