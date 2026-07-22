# RoomHash Market Protocol v1

## 状态模型

协议有两类签名事件：

1. `roomhash.market/listing-v1`：公开商品事件。`listingId` 必须为 `<sellerHash>:<slug>`，从而把 seller hash 固定为所有者键。事件含卖家签名/加密公钥、公开身份、标题、价格、介绍、媒体描述符、`active|withdrawn`、revision 和时间。
2. `roomhash.market/purchase-intent-v1`：公开路由元数据与加密 envelope。`orderIntentId` 必须为 `<buyerHash>:<128-bit random>`。联系方式、收货/交付方式、买家昵称和备注位于 AES-GCM 密文内。

当前状态按逻辑键取确定性 LWW：先比较整数 `revision`，相同时取字典序较大的 `eventId`。`eventId` 是规范化无签名事件的 SHA-256。所有 listing 更新必须能由 listing 内卖家公钥验证；该公钥 SHA-256 必须等于 `sellerHash`。意向同理验证买家签名。

撤下是 `status: withdrawn` 的新 revision，不删除旧知识。协议拒绝资金处理相关字段。

## 帧与多跳

`roomhash.market/frame-v1` 包含：

```text
roomId, frameId, originId, destinationId?, hops, maxHops, type, payload
```

节点按 `frameId` 去重防止环路 echo，最多转发 16 跳，并在转发时排除来源 peer（transport 支持时）。公开事件以 `event` 帧洪泛。购买意向也是公开传播的事件，但敏感字段只存在于密文。

anti-entropy 使用：

- `inventory`：每个当前 listing/order intent 的 kind、逻辑 key、eventId 和 revision；
- `want`：接收端缺少/不同的 eventId；
- `events`：按 eventId 返回完整签名事件；接收端验证后，以新 frameId 重广播新学到的 winner。

寻址修复帧可以跨中继，到达 destination 后停止。节点永远不应把未通过 schema、hash 和签名校验的事件继续转发。协议是最终一致的 best-effort 系统，不是全局完整视图。

## 购买意向 envelope

卖家 listing 携带独立的 ECDH P-256 公钥。买家为每条意向生成临时 ECDH P-256 密钥：

1. 临时私钥与卖家公钥执行 ECDH 得到 256-bit shared secret；
2. 随机 128-bit salt，HKDF-SHA-256 派生 AES-256-GCM key；
3. 随机 96-bit IV；
4. 将 schema、intent/listing ID、双方 hash、revision、时间的规范化 JSON 作为 HKDF info 和 AES-GCM additional data；
5. 加密 `{buyerNick, contact, delivery, note, createdAt}`；
6. 公布临时公钥、salt、IV、ciphertext，并由买家 ECDSA P-256 签名整个意向。

只有持有 listing 对应 ECDH 私钥的卖家能解密。任何中继都可验证买家签名并转发密文。密钥轮换必须发布新 listing revision；旧私钥仍是解密旧意向所必需的。

## 媒体

Gossip 只含 `{kind,name,mime,size,sha256,magnet,webSeed}`。每个描述符必须有 SHA-256，并至少提供 magnet 或 HTTPS web seed（仅开发时允许 localhost HTTP）。

- 照片：JPEG/PNG/WebP/GIF，最多 8 个、每个 10 MiB；
- 视频：MP4/WebM，最多 2 个、每个 100 MiB；
- 总计最多 210 MiB。

接收方下载后必须重新计算 SHA-256。`blob:` Object URL 只在创建它的页面有效，不能传播。宿主应通过 RoomHash torrent.media seed 附件，再生成描述符。

## 已知限制

- 无全局时钟、全局总数、中心可用性或送达保证；revision 由事件所有者维护。
- `seenFrames` 和事件库存当前为内存集合；长期运行宿主应设置有界保留与持久化策略，同时避免过早丢弃造成重复洪泛。
- demo 的 BroadcastChannel 只能模拟同源多标签，不代表真实 NAT 穿透；真实多 NAT 依赖 RoomHash WebRTC/torrent.media transport 与 Headless 可达性。
- 不做付款、托管、钱包、库存锁定、履约确认、争议仲裁、身份认证或内容审核。
