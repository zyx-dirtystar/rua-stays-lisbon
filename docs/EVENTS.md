# 数据字典

所有时间为 UTC。客户端和服务端时间各自保留。`occurred_at` 优先使用在同意后且与服务端时钟相容的客户端时间，否则使用服务器到达时间。相同毫秒的事件以数据库落表次序作为第二排序键，并保留标签页内的 `event_seq`。

| CSV | 一行代表什么 | 标识 |
| --- | --- | --- |
| sessions | 一次同意后的实验会话与派生结果 | `participant_id`、`session_id` |
| rankings | 一份列表中的一个展示实例，空列表也保留一行 | `session_id`、`list_id`、`listing_instance_id` |
| events | 一条动作、曝光、持续时间或浏览器状态事件 | `session_id`、`event_id` |
| stimuli | 一个实验刺激与源表的映射 | `id` 对应事件及排名的 `hotel_id` |

`arm`、`focal_quality`、`retarget` 由服务端分配。`run_type` 为 `participant` 或 `preview`。`list_id` 表示某次显示的列表，`previous_list_id` 指向排序或筛选前的列表。默认位置记录于 `default_rank`，当前列表中的位置记录于 `actual_rank`。同一家酒店的第 1 与第 7 位分别为 `p01`、`p07`。筛选与排序保留展示实例身份，并重算 `actual_rank`。

| 事件 | 含义 |
| --- | --- |
| `consent_complete` | 服务端保存同意和分组 |
| `page_open`、`page_visible`、`page_hidden`、`page_exit` | 页面打开、前台变化与页面离开信号 |
| `heartbeat`、`page_dwell` | 前台仍活动，或一段前台停留结束。后者带 `duration_ms` |
| `card_loaded` | 卡片已加入页面，排名表记录可提供展示的分配 |
| `viewport_enter` / `viewport_exit` | 前台卡片进入／离开视口，或转后台后停止观察 |
| `card_impression` | 至少 50% 连续可见 1 秒，且页面处于前台 |
| `card_dwell` | 每次越过 50% 可见阈值后的前台持续时间，可低于 1 秒 |
| `scroll_depth` | 列表滚动深度每 5 个百分点跨档 |
| `click`、`hotel_open`、`return_to_results` | 具名控件点击、打开酒店意向和返回结果入口 |
| `search_submit`、`filter_apply`、`sort_change`、`list_applied` | 搜索或筛选／排序输入提交，新列表显示 |
| `room_select`、`rate_open`、`booking_enter`、`booking_review`、`booking_back` | 看价格条件、选房、进入或返回预订步骤 |
| `booking_confirm`、`explicit_exit` | 服务端确认模拟预订或主动退出，每个会话最多一个终态 |

第 7 位的到达和曝光使用默认展示实例 `p07`。如果主动排序改变它的位置，可按事件的 `actual_rank` 重建。后续首次行为以第 7 位的已记录曝光为时间零点。它取打开酒店、选房、进入或确认预订、主动退出、或首见第 8–13 位新酒店的首条事件。另有 `continued_to_new` 表示是否在后来看到公用尾部中的首次可见新酒店。`booked_focal` 比较最终 `hotel_id` 与最初焦点，`final_instance_id` 标记实际从哪次展示进入预订。

关闭页面只是一项浏览器信号。未产生预订或主动退出终态的会话为 `unfinished`，退出原因 `unknown`。`activity_status` 按最后保存时间区分近期有活动及 30 分钟超时。浏览器强退或离线可能损失最后一批尚未交付的事件，分析可用最后已确认事件及缺失状态。预订资料为界面预填测试值，行为数据字段仅记录实验动作和结果。

