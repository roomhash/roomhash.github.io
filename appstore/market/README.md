# RoomHash Distributed Market

一个独立、无中心数据库的公开商品目录与买卖搭线 demo。商品发布、更新和撤下通过签名事件在 Mesh 中多跳传播；购买意向中的联系方式、收货方式和备注只以卖家公钥加密的密文传播。

## 运行

需要 Node.js 20+，无第三方依赖：

```sh
npm run check
npm run serve
```

打开 `http://127.0.0.1:4175`，再开一个标签页。每个标签页使用独立的临时身份，`BroadcastChannel` 模拟 Mesh。发布商品或购买意向后，可点击“广播同步清单”触发 anti-entropy。

`npm run build` 会从源码重建 `dist/`，同时生成 `dist/integrity.json` 的 SHA-256 清单。`dist/` 可直接复制到静态站点的 `appstore/market/`。

## 产品边界

- 商品列表、价格、介绍、媒体元数据、卖家昵称、卖家 hash、公开联系身份和公钥全部公开。
- “确认购买”只是发送购买意向。卖家解密后应主动联系买家，双方在线下商讨交付。
- 不包含线上付款、钱包、托管、支付/退款状态或任何资金处理流程。
- 每个节点展示自己的本地收集视图。网络分区、离线、TTL、节点退出或尚未完成补齐时，不同人看到的目录可能不同；它不是强一致的中央商城。
- demo 身份私钥和状态只存于当前标签页的 `sessionStorage`。关闭标签页会丢失卖家解密能力；生产宿主必须提供安全、可备份的密钥存储。

## RoomHash 集成边界

当前 RoomHash WASM ABI 适合较简单的交互，不适合 Market 的表单、媒体选择、密钥生命周期和加密收件箱，因此 manifest 明确声明：

```json
{ "runtime": "standalone-web", "currentRoomHashWasmCompatible": false }
```

`src/host-adapter.js` 定义了最小 transport contract。RoomHash 宿主把 `send/subscribe/onPeerConnected` 映射到 torrent.media 数据通道即可；协议核心负责多跳、`frameId`/事件 ID 去重和 anti-entropy。不要改写转发 frame。

媒体字节不放进 Gossip JSON。宿主应把 `File` 交给 torrent.media 发布，返回 `{name,mime,size,sha256,magnet,webSeed}`；协议只传播该内容寻址描述符。本地 `Object URL` 仅供预览，绝不能写入 frame。

## 密码学和隐私

购买意向使用浏览器 Web Crypto：临时 ECDH P-256 协商、HKDF-SHA-256 派生、AES-256-GCM 加密，并把公开路由元数据作为 AEAD additional data。每个事件使用 ECDSA P-256 签名；`userHash` 是规范化签名公钥的 SHA-256。没有自定义密码算法。

但加密不隐藏所有元数据：观察者仍能看到 listing ID、intent ID、买家/卖家 hash、时间、密文大小和传播关系。昵称/地址等明文只在卖家解密后出现。卖家可以自行泄露解密结果，恶意客户端也可截屏。

信任边界：

- 公钥 hash 只能证明“同一密钥”，不能证明现实身份。公开昵称和联系身份可能被冒充；需要线下或其他可信渠道核验。
- 卖家私钥丢失后无法解密历史或新意向；私钥泄露则历史密文可能被解密。本协议不提供密钥恢复或前向保密保证。
- Mesh 节点可能丢包、拒绝转发、审查或重放。去重与 anti-entropy 改善收敛，不保证全网送达。
- 内容 hash 可验证下载字节，但不会证明照片、视频或商品描述真实，也不提供内容审核。
- 买家应只提供完成联络所需的最少信息；公开终端、共享浏览器和恶意扩展可能读取解密后的内容。

详见 [PROTOCOL.md](./PROTOCOL.md)。
