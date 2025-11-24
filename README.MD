🚀 FourMeme Trading Bot - 独立运行版本

定位：运行于用户电脑或服务器的开源 FOUR.MEME 交易工具。无服务端、程序无状态，单次 RPC 请求聚合必要信息，保持在较高网络延迟下的查询与交易效率。

本项目在 Windows 下提供两种使用形态：
- 源码版：基于 Node.js 直接运行源码（推荐开发/调试）
- 免安装 EXE 版：打包为单文件可执行程序（推荐纯使用场景）

建议 Node 版本：v22.5.1（用于源码版运行）

## Windows 源码版

适用场景：希望保留源码结构，方便修改/调试；或在本地以最快速度运行。

1) 复制并填写配置
   - 将 `.env.example` 复制为 `.env`
   - 配置必要字段：
     - `PORT`：服务端口（如 `8787`）
     - `HOST`：绑定地址（如 `127.0.0.1` 或 `0.0.0.0`）
     - `API_WHITELIST`：IP 白名单（逗号分隔，支持 IPv4 与 CIDR）
     - `EVM_WALLETS`：钱包数组，包含 `id` / `name` / `privateKey`

2) 安装运行环境
   - 安装 Node.js v22.5.1（自带 npm）
   - 在项目根目录执行依赖安装：
     - `npm ci --only=production`
     - 若遇到网络问题，可使用镜像或 `npm install --omit=dev`

3) 启动服务
   - 双击 `run.bat` 或在终端执行：`node run.js`
   - 启动成功后默认在 `http://127.0.0.1:8787`（或你在 `.env` 中指定的地址/端口）提供接口

4) 常见问题
   - 启动报错 `FORBIDDEN`：检查 `API_WHITELIST` 是否包含你的访问 IP 或正确的 CIDR（如 `127.0.0.1,10.0.0.0/8`）
   - 端口被占用：修改 `.env` 中的 `PORT` 或释放占用该端口的程序
   - WebSocket 相关报错：通常为 RPC 网络波动，程序包含自动重连逻辑，可稍后重试

## Windows 免安装 EXE 版

适用场景：不希望安装 Node.js；只需一个可执行文件即可使用。

1) 获取 EXE
   - 从仓库 Release（例如 `v1.0.1`）下载 `showdog-api.exe`

2) 准备配置
   - 将 `.env.example` 复制为 `.env`，放置在 `showdog-api.exe` 同级目录
   - 配置同上（`PORT`、`HOST`、`API_WHITELIST`、`EVM_WALLETS`）

3) 运行
   - 直接双击 `showdog-api.exe`
   - 首次运行若被安全软件拦截，请允许（该程序为开源打包，内置运行时，非恶意软件）

4) 注意事项
   - EXE 版已内置运行时，无需安装 Node.js
   - 仍需在同级目录提供 `.env` 文件才能正常启动
   - 如需更新，直接替换为新版 EXE 即可

## 安全提示（强烈建议）

若在公网环境运行且未做 IP 访问限制，请自行解决 API 调用的安全层面问题（例如严格配置 `API_WHITELIST`，网关/防火墙限制来源 IP）。否则可能存在资金风险。

## 开源与费用声明

- 工具代码 100% 开源，作者未收取任何费用。
- 所有交易调用均通过 FOUR.MEME 官方合约地址与 PancakeSwap V2 合约地址进行，无任何抽佣行为。（信息聚合查询合约为作者自行编写仅提供信息查询功能）
- 开源原因：作者非常赞同 Vitalik Buterin 提及的区块链应用的终极形态应该是无需信任、免许可、高度去中心化的，用户直接与区块链网络交互的理念，私钥应该由自己保管，不应该被任何第三方获取。
- 免责声明：使用产生的任何收益与亏损均与作者无关，请在合法合规的前提下使用本工具，下载使用即视为同意本条款，作者不承担任何法律责任。

## 功能与支持范围

- 支持 FOUR.MEME 的 X 模式与普通模式。
- 支持 FOUR.MEME 的 BNB / CAKE / USDT / USD1 / ASTER 作为底池的代币。
- 支持 FOUR.MEME 的内盘与外盘交易。
- 不支持所有非 FOUR.MEME 平台的代币。

## API 文档

- 中文：https://docs.showdog.pro/cn/APISERVER_README.html
- 英文：https://docs.showdog.pro/en/APISERVER_README.html

## 适配与后续计划

已在秀狗推特监控客户端适配该 API 工具的 UI 界面，未来可能考虑为本项目单独提供 UI，视用户反馈决定。

秀狗官网：https://www.showdog.pro/

秀狗推特监控 PC 端支持导入配置文件对接钱包端，配置里使用 `http://127.0.0.1:8787` 为默认 URL 也可视情况自行替换。
配置文件：`showdog-token-config.json`

秀狗推特监控客户端使用了此项目API的示例视频
https://download.showdog.pro/static/download/docs/3.mp4
官方电报群：https://t.me/showdog_x
