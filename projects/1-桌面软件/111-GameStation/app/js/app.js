(function(){
"use strict";
const games=[
{id:"gomoku",name:"五子棋",category:"board",categoryName:"棋类",icon:"⚫",description:"五子连线获胜。",status:"prototype",entry:"./games/gomoku/index.html",modes:["人机对战","本机双人"],difficulty:true,tip:"黑棋先行，率先在横、竖或斜线上连成五子的一方获胜。",help:[["基本规则","黑棋先行，双方轮流在棋盘交叉点落子。先形成连续五子的一方获胜。"],["操作","点击交叉点落子；悔棋按钮撤回上一步。人机模式由你执黑棋。"],["对战设置","顶部模式切换可选择人机或本机双人；难度分为简单、中等、困难。"],["AI 难度","简单：优先处理立即成五和必须防守，再从高分候选中随机选择；中等：攻防加权评分；困难：三层对抗式候选搜索，识别断点威胁并评估对手回应。"],["策略提示","优先争夺活三、冲四等连续威胁，同时留意对手的直接成五机会。"]]},
{id:"xiangqi",name:"中国象棋",category:"board",categoryName:"棋类",icon:"♟️",description:"楚河汉界，调度车马炮。",status:"prototype",entry:"./games/xiangqi/index.html",modes:["人机对战","本机双人"],difficulty:true,tip:"点击己方棋子，再点击合法目标位置。",help:[["基本规则","红黑双方轮流走子，目标是将死对方将帅。将帅不能照面。"],["棋子走法","将帅九宫一步；士斜走一步；象走田且不能塞象眼；马走日且不能蹩马腿；车直线；炮隔一子吃子；兵卒过河后可横走。"],["操作","点击己方棋子，再点击高亮的合法落点。可使用顶部模式和难度切换。"],["胜负","一方被将军且无合法应对时判负；无合法着法也判负。"]]},
{id:"reversi",name:"黑白棋",category:"board",categoryName:"棋类",icon:"⚪",description:"翻转棋子，占领更多格子。",status:"ready",entry:"./games/reversi/index.html",modes:["人机对战","本机双人"],difficulty:true,tip:"只能落在至少夹住一枚对方棋子的位置。",help:[["基本规则","双方轮流落子，夹住对方连续棋子后翻转。终局棋子较多的一方获胜。"],["操作","点击棋盘上可落子的格子。无合法步时自动跳过；双方均无合法步时结束。"],["对战设置","顶部可切换人机/双人及 AI 难度。"],["策略提示","角落非常重要；避免轻易占据会让对手获得角落的位置。"]]},
{id:"connect4",name:"四子棋",category:"board",categoryName:"棋类",icon:"🔴",description:"先将四枚棋子连成一线。",status:"ready",entry:"./games/connect4/index.html",modes:["人机对战","本机双人"],difficulty:true,tip:"选择列落子，棋子会落到最低空位。",help:[["基本规则","双方轮流把棋子投入七列棋盘，先在横、竖或斜线上连成四枚的一方获胜。"],["操作","点击任意列，棋子落入该列最低空位。"],["对战设置","顶部可切换人机/双人和 AI 难度。"],["策略提示","优先检查立即获胜点和对手的下一步连四威胁。"]]},
{id:"battleship",name:"海战棋",category:"board",categoryName:"棋类",icon:"🚢",description:"根据命中线索寻找隐藏舰队。",status:"ready",entry:"./games/battleship/index.html",difficulty:true,tip:"点击敌方海域攻击，击沉全部舰船即可获胜。",help:[["基本规则","敌我双方各有长度为 5、4、3、3、2 的舰船。先击沉对方全部舰船的一方获胜。"],["操作","点击敌方海域进行攻击。命中和未命中会分别标记。"],["AI 难度","简单随机搜索；中等采用命中追击；困难进一步利用舰船长度和剩余可能位置进行概率搜索。"],["策略提示","命中后优先检查相邻格，连续命中时沿直线追击。"]]},
{id:"chinese-checkers",name:"中国跳棋",category:"board",categoryName:"棋类",icon:"🔵",description:"121 孔六角星棋盘，十枚棋子连续跳跃到对面营地。",status:"playable",entry:"./games/chinese-checkers/index.html",modes:["人机对战","本机多人"],difficulty:true,tip:"1号玩家始终在下方；支持本机多人和多电脑对手，选择棋子后点绿色落点。",help:[["玩法","将十枚棋子全部移动至正对面三角营地即可获胜。"],["走法","六方向相邻走一步，或隔一颗棋子跳过至后方空点，可以连续跳跃且不吃子。"],["难度","简单随机合法移动，中等按目标前进评分，困难加入一回合对手回应评估。"],["操作","点击棋子后选择高亮落点，工具菜单支持悔棋。"]]},
{id:"flight-chess",name:"飞行棋",category:"board",categoryName:"棋类",icon:"✈️",description:"52 格航线、六点起飞、同色跳跃、撞机与终点竞速。",status:"playable",entry:"./games/flight-chess/index.html?v=flight-photo-r58",modes:["人机对战","本机双人"],difficulty:true,tip:"右侧投掷骰子，掷六点起飞；点击高亮飞机预览路线。",help:[["目标","经典四角四色棋盘；当前为红蓝两方各四架，率先全部精确到达终点获胜。"],["规则","掷六点可起飞并获得额外回合；同色格可前进四格，特殊标记格可飞行；非安全格撞机返回机场。"],["操作","点击中央掷骰子，然后点击可移动的飞机；工具菜单可以悔棋。"],["难度","简单随机选择飞机、中等优先快速前进与撞机、困难评估对手下一次掷骰造成的风险。"]]},
{id:"checkers",name:"西洋跳棋（8×8）",category:"board",categoryName:"棋类",icon:"⚫",description:"跳跃吃子，升变为王。",status:"ready",entry:"./games/checkers/index.html",modes:["人机对战","本机双人"],difficulty:true,tip:"有吃子机会时必须吃子。",help:[["基本规则","棋子沿深色格斜向前进；跳过相邻敌棋并落在其后空格即可吃子。到达底线升变为王。"],["强制吃子","存在吃子机会时必须选择吃子；连续吃子应继续完成。"],["操作","点击己方棋子，再点击合法目标格。"],["对战设置","顶部切换人机/双人和简单、中等、困难。"]]},
{id:"chess",name:"国际象棋",category:"board",categoryName:"棋类",icon:"♞",description:"标准 8×8 棋盘，支持王车易位与吃过路兵。",status:"prototype",entry:"./games/chess/index.html",modes:["人机对战","本机双人"],difficulty:true,tip:"白方先行，选择棋子后点击合法落点。",help:[["基本规则","白方先行，目标是将死对方王。兵到达底线自动升变为后。"],["特殊规则","支持王车易位、吃过路兵、升变、将军、将死和逼和。"],["操作","点击己方棋子，再点击高亮的合法落点；Esc 取消选择，U 悔棋。"],["对战设置","顶部可切换人机对战或本机双人，以及 AI 难度。"]]},
{id:"minesweeper",name:"扫雷",category:"puzzle",categoryName:"益智",icon:"💣",description:"根据数字提示找出全部地雷。",status:"ready",entry:"./games/minesweeper/index.html",difficulty:true,difficultyLabels:["初级","中级","高级"],tip:"左键翻开，右键标记；首次点击安全。",help:[["目标","翻开所有非地雷格子，不要踩中地雷。"],["操作","鼠标左键翻开；右键标记或取消旗帜。第一次点击保证安全。"],["难度","初级 9×9/10 雷；中级 16×16/40 雷；高级 30×16/99 雷。"],["提示","数字表示周围八格中的地雷数量。"]]},
{id:"2048",name:"2048",category:"puzzle",categoryName:"益智",icon:"🔢",description:"合并相同数字，挑战更高分数。",status:"ready",entry:"./games/2048/index.html",tip:"使用方向键或触摸滑动。",help:[["目标","将相同数字方块合并，尽可能得到 2048 或更高数字。"],["操作","方向键或滑动控制整体移动；相同数字碰撞时合并。"],["计分","每次合并的数值计入分数。棋盘没有可移动空间时结束。"],["策略","尽量让最大数字固定在角落，并保持单调排列。"]]},
{id:"memory",name:"记忆翻牌",category:"puzzle",categoryName:"益智",icon:"🃏",description:"记住图案位置，完成所有配对。",status:"ready",entry:"./games/memory/index.html",difficulty:true,difficultyLabels:["简单","标准","困难"],tip:"每次翻开两张卡片，寻找相同图案。",help:[["目标","找出所有相同图案的配对。"],["操作","每次点击两张卡片；配对成功会保持翻开，不匹配则稍后盖回。"],["难度","简单、标准和困难对应不同牌数。"],["计分","尽量减少翻牌次数和完成时间。"]]},
{id:"sudoku",name:"数独",category:"puzzle",categoryName:"益智",icon:"🔢",description:"用逻辑填满九宫格。",status:"ready",entry:"./games/sudoku/index.html",difficulty:true,difficultyLabels:["简单","标准","困难"],tip:"每行、每列和每个 3×3 宫均需填入 1–9。",help:[["规则","每一行、每一列及每个 3×3 宫都必须包含 1 至 9，且不能重复。"],["操作","选择空格后输入数字；可使用数字键或屏幕数字键。"],["辅助","提示可填入一个正确数字；检查可标出冲突。"],["难度","顶部切换简单、标准、困难。"]]},
{id:"sokoban",name:"推箱子",category:"puzzle",categoryName:"益智",icon:"📦",description:"推动箱子到达所有目标点。",status:"ready",entry:"./games/sokoban/index.html",tip:"方向键移动，Z 撤销，R 重置。",help:[["目标","将所有箱子推到目标点。"],["操作","方向键移动；只能推动箱子，不能拉动。Z 撤销一步，R 重置当前关卡。"],["注意","不要把箱子推入无法离开的角落。"],["关卡","完成当前关卡后进入下一关。"]]},
{id:"tetris",name:"俄罗斯方块",category:"arcade",categoryName:"街机",icon:"🧩",description:"旋转方块，消除整行。",status:"ready",entry:"./games/tetris/index.html",difficulty:true,difficultyLabels:["慢速","标准","快速"],tip:"← → 移动，↑ 旋转，↓ 加速，空格硬降。",help:[["目标","通过移动和旋转方块填满整行，消除行并获得分数。"],["操作","←/→ 移动，↑ 旋转，↓ 加速下落，空格硬降。"],["难度","慢速、标准、快速决定初始下落速度。"],["计分","一次消除多行可获得更高分数；等级随消除行数提升。"]]},
{id:"snake",name:"贪吃蛇",category:"arcade",categoryName:"街机",icon:"🐍",description:"吃到食物增长，避免碰撞。",status:"ready",entry:"./games/snake/index.html",difficulty:true,difficultyLabels:["慢速","标准","快速"],tip:"方向键控制移动。",help:[["目标","吃到食物增长身体，尽可能获得高分。"],["操作","方向键控制方向；不能直接反向进入自己的身体。"],["难度","慢速、标准、快速对应不同移动速度。"],["结束","撞墙或撞到自身时游戏结束。"]]},
{id:"pong",name:"Pong",category:"arcade",categoryName:"街机",icon:"🏓",description:"控制球拍，与电脑争夺分数。",status:"ready",entry:"./games/pong/index.html",difficulty:true,tip:"W/S 或 ↑/↓ 控制球拍，也可使用鼠标。",help:[["目标","先达到目标分数的一方获胜。"],["操作","W/S 或 ↑/↓ 控制左侧球拍，也可移动鼠标。"],["AI 难度","简单反应较慢；中等跟随球路；困难更积极预测落点。"],["比赛","顶部暂停和新局控制整场比赛。"]]},
{id:"contra",name:"魂斗罗（原创模式）",category:"arcade",categoryName:"街机",icon:"🎯",description:"原创像素风横版射击。",status:"prototype",entry:"./games/contra/index.html",difficulty:true,tip:"A/D 移动，W 或空格跳跃，J 射击。",help:[["玩法","这是独立原创的横版射击玩法，不包含原作 ROM、图像或音乐。"],["操作","A/D 移动，W 或空格跳跃，J 射击。"],["目标","躲避敌人攻击并击败敌人，尽可能走得更远。"],["难度","调整敌人出现频率、移动速度和玩家容错。"]]},
{id:"mario",name:"超级玛丽",category:"arcade",categoryName:"街机",icon:"🍄",description:"原创像素横版平台跳跃，收集金币抵达终点。",status:"prototype",entry:"./games/mario/index.html",difficulty:true,difficultyLabels:["轻松","标准","挑战"],tip:"A/D 或方向键移动，空格跳跃，Shift 加速。",help:[["目标","穿过平台、收集金币并抵达旗杆终点。"],["操作","A/D 或方向键移动，空格跳跃，Shift 加速。"],["敌人","从上方踩中敌人可以消灭它；侧面碰撞会损失生命。"],["关卡","当前为原创 1-1 关卡，完成后记录得分。"]]},
{id:"tank",name:"90 坦克",category:"arcade",categoryName:"街机",icon:"🪖",description:"像素坦克大战，摧毁敌军并守住基地。",status:"prototype",entry:"./games/tank/index.html",difficulty:true,difficultyLabels:["简单","标准","困难"],tip:"方向键或 WASD 移动，空格发射炮弹。",help:[["目标","守住底部基地，击毁全部 20 辆敌方坦克。"],["操作","方向键或 WASD 移动并改变炮口方向，空格发射。"],["地形","砖墙可被炮弹摧毁，钢墙不可穿透，水域阻挡坦克。"],["失败条件","敌方炮弹击中基地，或玩家生命耗尽时任务失败。"]]},
{id:"solitaire",name:"经典纸牌",category:"card",categoryName:"卡牌",icon:"🃏",description:"按花色将牌从 A 排到 K。",status:"playable",entry:"./games/solitaire/index.html",difficulty:true,difficultyLabels:["抽一张","抽三张"],tip:"红黑交替、点数递减移动牌列。",help:[["目标","将四种花色分别从 A 到 K 移入基础牌堆。"],["操作","点击牌堆抽牌；点击明牌后再点击目标牌列或基础牌堆。"],["移动规则","牌列按红黑交替、点数递减排列；空列只能放 K。"],["难度","抽一张较易；抽三张更具挑战。"]]},
{id:"doudizhu",name:"斗地主",category:"card",categoryName:"卡牌",icon:"🃏",description:"单人对战两名本地 AI。",status:"playable",entry:"./games/doudizhu/index.html",difficulty:true,difficultyLabels:["入门 AI","标准 AI","强力 AI"],tip:"先叫地主，再按牌型出牌。",help:[["基本流程","三人游戏，发牌后竞叫地主。地主获得底牌并先出牌；先出完手牌的一方获胜。"],["牌型","单张、对子、三张、三带、顺子、连对、飞机、四带二、炸弹和王炸。"],["操作","选择手牌后出牌；无法压过上家时可以不出。"],["AI","AI 根据当前可见牌局、已出牌和自身手牌作出判断，不读取其他玩家隐藏手牌。"]]},
{id:"mahjong",name:"麻将",category:"card",categoryName:"卡牌",icon:"🀄",description:"四人麻将，可调整常用规则。",status:"prototype",entry:"./games/mahjong/index.html",difficulty:true,tip:"摸牌、打牌，组成面子和将牌。",help:[["基本规则","四人、136 张基础牌。通过顺子、刻子、杠子和一对将组成和牌结构。"],["操作","摸牌后选择一张打出；可根据上家弃牌执行吃、碰、杠或胡。"],["规则设置","本局可切换允许吃牌、七对胡牌和允许杠牌；杠后补牌可自摸胡牌。当前采用 136 张基础牌，不含花牌。"],["AI","电脑仅依据自己手牌、公开弃牌和已公开副露决策。"]]},
{id:"sanguosha",name:"三国杀",category:"card",categoryName:"卡牌",icon:"⚔️",description:"身份局基础包与小乔扩展角色。",status:"prototype",entry:"./games/sanguosha/index.html",difficulty:true,tip:"摸牌、出牌、响应杀闪，完成身份目标。",help:[["身份与目标","身份局中各角色拥有隐藏身份和不同胜利目标。主公需要存活并清除反贼与内奸。"],["回合流程","回合开始摸两张牌，出牌阶段可使用手牌，最后结束回合。角色体力归零时进入濒死与桃自救流程。"],["基本牌与锦囊","当前本地规则包含杀、闪、桃、酒，以及决斗、过河拆桥、顺手牵羊、无中生有、南蛮入侵、万箭齐发和桃园结义。装备、判定区与完整标准牌堆仍待扩展。"],["小乔技能","红颜：黑桃视为红桃；天香：受到伤害时，可弃置红桃（含红颜转换的黑桃）转移伤害，目标受到伤害后按已损失体力摸牌。"]]}
];
const categoryNames={all:"全部游戏",board:"棋类",puzzle:"益智",arcade:"街机",card:"卡牌"};
const $=id=>document.getElementById(id),shell=$("appShell"),homeView=$("homeView"),libraryView=$("libraryView"),workspaceView=$("workspaceView"),frame=$("gameFrame"),storePrefix="gamestation.";
const icons={play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg><span class="action-label">开始</span>',stop:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/></svg><span class="action-label">结束</span>',pause:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg><span class="action-label">暂停</span>',resume:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg><span class="action-label">继续</span>',next:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14l11-7zM19 5v14"/></svg><span class="action-label">下一局</span>'};
const gameVectorArt={
 gomoku:'<rect x="6" y="6" width="52" height="52" rx="8" fill="#e8c98f" stroke="#9c713e" stroke-width="3"/><path d="M19 13v38M32 13v38M45 13v38M13 19h38M13 32h38M13 45h38" stroke="#a77b47" stroke-width="1.5"/><circle cx="23" cy="25" r="8" fill="#252b31" stroke="#101820" stroke-width="2"/><circle cx="42" cy="40" r="8" fill="#fff" stroke="#77828b" stroke-width="2"/>',
 xiangqi:'<rect x="7" y="7" width="50" height="50" rx="5" fill="#f1d9ad" stroke="#9a6840" stroke-width="3"/><path d="M17 12v40M27 12v40M37 12v40M47 12v40M12 17h40M12 27h40M12 37h40M12 47h40" stroke="#a16e42" stroke-width="1.5"/><circle cx="32" cy="32" r="15" fill="#fff1d4" stroke="#b33b35" stroke-width="3"/><path d="M32 22v20M22 32h20M25 25l14 14M39 25L25 39" stroke="#b33b35" stroke-width="3" stroke-linecap="round"/>',
 reversi:'<rect x="6" y="6" width="52" height="52" rx="7" fill="#238451" stroke="#12633b" stroke-width="3"/><path d="M23 8v48M40 8v48M8 23h48M8 40h48" stroke="#b7e3c9" stroke-width="1.5" opacity=".8"/><circle cx="23" cy="23" r="9" fill="#20272d" stroke="#e6f3ec" stroke-width="1.5"/><circle cx="40" cy="40" r="9" fill="#f7fbf8" stroke="#1e573a" stroke-width="1.5"/>',
 connect4:'<rect x="6" y="7" width="52" height="50" rx="8" fill="#2879c7" stroke="#175a9a" stroke-width="3"/><g fill="#e8f3ff" stroke="#164f8a" stroke-width="1.5"><circle cx="19" cy="20" r="6"/><circle cx="32" cy="20" r="6"/><circle cx="45" cy="20" r="6"/><circle cx="19" cy="34" r="6"/><circle cx="32" cy="34" r="6"/><circle cx="45" cy="34" r="6"/><circle cx="19" cy="48" r="6"/><circle cx="32" cy="48" r="6"/><circle cx="45" cy="48" r="6"/></g><circle cx="19" cy="34" r="5" fill="#e94c42"/><circle cx="32" cy="48" r="5" fill="#f4c844"/><circle cx="45" cy="48" r="5" fill="#e94c42"/>',
 battleship:'<rect x="5" y="8" width="54" height="48" rx="8" fill="#8bc7e8" stroke="#397eaa" stroke-width="3"/><path d="M8 24q8-6 16 0t16 0t16 0M8 45q8-6 16 0t16 0t16 0" fill="none" stroke="#e8f7ff" stroke-width="3" stroke-linecap="round"/><path d="M12 35h40l-7 10H20z" fill="#435b70" stroke="#24394b" stroke-width="2"/><path d="M25 35V25h12v10M29 25v-5h5v5" fill="#e6edf2" stroke="#52697b" stroke-width="2"/>',
 "chinese-checkers":'<path d="M32 5L59 52H5z" fill="#e6edf4" stroke="#849caf" stroke-width="2.5" stroke-linejoin="round"/><g stroke="#fff" stroke-width="1.5"><circle cx="32" cy="13" r="4.5" fill="#e54f4c"/><circle cx="25" cy="25" r="4.5" fill="#e54f4c"/><circle cx="39" cy="25" r="4.5" fill="#e54f4c"/><circle cx="18" cy="37" r="4.5" fill="#3b83c6"/><circle cx="32" cy="37" r="4.5" fill="#3b83c6"/><circle cx="46" cy="37" r="4.5" fill="#3b83c6"/><circle cx="11" cy="49" r="4.5" fill="#e4b83f"/><circle cx="25" cy="49" r="4.5" fill="#e4b83f"/><circle cx="39" cy="49" r="4.5" fill="#e4b83f"/><circle cx="53" cy="49" r="4.5" fill="#e4b83f"/></g>',
 "flight-chess":'<path d="M31 5q4-1 5 5l3 17 17 9q3 2 1 5l-2 3-18-5-1 12 7 5v3l-11-3-11 3v-3l7-5-1-12-18 5-2-3q-2-3 1-5l17-9 3-17q1-5 8-5z" fill="#3f83c7" stroke="#205b91" stroke-width="2" stroke-linejoin="round"/><path d="M32 10l3 18-3 5-3-5z" fill="#f4d34d"/><path d="M10 37l17-8M54 37L37 29" stroke="#e95a4e" stroke-width="3" stroke-linecap="round"/>',
 checkers:'<rect x="7" y="7" width="50" height="50" rx="5" fill="#e7edf2" stroke="#6b8092" stroke-width="2.5"/><path d="M7 7h12.5v12.5H7zm25 0h12.5v12.5H32zM19.5 19.5H32V32H19.5zm25 0H57V32H44.5zM7 32h12.5v12.5H7zm25 0h12.5v12.5H32zM19.5 44.5H32V57H19.5zm25 0H57V57H44.5z" fill="#516170"/><circle cx="25.5" cy="25.5" r="7" fill="#d84d49" stroke="#8d292b" stroke-width="2"/><circle cx="44.5" cy="44.5" r="7" fill="#28323c" stroke="#111a21" stroke-width="2"/>',
 chess:'<path d="M19 54h31v-5l-5-4-2-9 5-7-5-7-8-1 1-7-7-7-7 5-1 8-8 5 4 8-4 9-5 7v5z" fill="#e9edf0" stroke="#465767" stroke-width="3" stroke-linejoin="round"/><path d="M28 24l7-3 6 5-4 5-9-1z" fill="#465767"/><path d="M15 57h37" stroke="#465767" stroke-width="4" stroke-linecap="round"/>',
 minesweeper:'<rect x="6" y="6" width="52" height="52" rx="7" fill="#77b5e1" stroke="#397ba9" stroke-width="3"/><path d="M13 13h38v38H13z" fill="none" stroke="#dff3ff" stroke-width="2"/><circle cx="32" cy="34" r="11" fill="#263644" stroke="#142432" stroke-width="2"/><path d="M32 17v5M32 46v4M15 34h5M44 34h5M20 22l4 4M40 42l4 4M44 22l-4 4M24 42l-4 4" stroke="#263644" stroke-width="3" stroke-linecap="round"/><circle cx="28" cy="30" r="3" fill="#c9d8e2"/>',
 "2048":'<rect x="6" y="6" width="52" height="52" rx="8" fill="#b8a997" stroke="#8f7e6b" stroke-width="2.5"/><rect x="11" y="11" width="19" height="19" rx="4" fill="#eee4d8"/><rect x="34" y="11" width="19" height="19" rx="4" fill="#f2c987"/><rect x="11" y="34" width="19" height="19" rx="4" fill="#efaa78"/><rect x="34" y="34" width="19" height="19" rx="4" fill="#e97856"/><path d="M20 16v9M43 16v9M20 39v9M43 39v9" stroke="#fff" stroke-width="3" stroke-linecap="round"/>',
 memory:'<rect x="9" y="11" width="31" height="42" rx="5" fill="#fff" stroke="#738da3" stroke-width="2.5" transform="rotate(-9 24 32)"/><rect x="25" y="9" width="30" height="42" rx="5" fill="#dcecf8" stroke="#4b8ab6" stroke-width="2.5" transform="rotate(8 40 30)"/><path d="M23 23c-5-7-14 1-7 8l8 8 8-8c7-7-2-15-9-8z" fill="#e66c73"/><path d="M39 22l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#e7b94c"/>',
 sudoku:'<rect x="7" y="7" width="50" height="50" rx="5" fill="#f7fbfd" stroke="#4b7b9d" stroke-width="3"/><path d="M23.7 8v48M40.3 8v48M8 23.7h48M8 40.3h48" stroke="#7899b0" stroke-width="2"/><path d="M8 8h15.7v15.7H8z" fill="#8ec3e4" opacity=".9"/><path d="M27 15h10M32 10v10M44 32h8M15 45h8" stroke="#39769e" stroke-width="2.5" stroke-linecap="round"/>',
 sokoban:'<rect x="7" y="7" width="50" height="50" rx="7" fill="#dce7d5" stroke="#78946d" stroke-width="3"/><circle cx="44" cy="20" r="8" fill="#f1c94d" stroke="#a47e24" stroke-width="2"/><path d="M14 28h28v24H14z" fill="#c28a4c" stroke="#81552d" stroke-width="3"/><path d="M14 28l14 12 14-12M28 40v12" fill="none" stroke="#f0c58c" stroke-width="2.5"/>',
 tetris:'<rect x="7" y="7" width="50" height="50" rx="6" fill="#e8f1f8" stroke="#7895aa" stroke-width="2.5"/><g stroke="#fff" stroke-width="1.5"><rect x="13" y="13" width="12" height="12" rx="2" fill="#e95d56"/><rect x="25" y="13" width="12" height="12" rx="2" fill="#e95d56"/><rect x="37" y="13" width="12" height="12" rx="2" fill="#e95d56"/><rect x="37" y="25" width="12" height="12" rx="2" fill="#e95d56"/><rect x="13" y="37" width="12" height="12" rx="2" fill="#4d9dd1"/><rect x="25" y="37" width="12" height="12" rx="2" fill="#4d9dd1"/><rect x="37" y="37" width="12" height="12" rx="2" fill="#4d9dd1"/></g>',
 snake:'<rect x="6" y="6" width="52" height="52" rx="8" fill="#e9f3e5" stroke="#83a77a" stroke-width="2.5"/><path d="M14 43h10q8 0 8-8V23q0-7 8-7h8" fill="none" stroke="#4b9c60" stroke-width="8" stroke-linecap="round"/><circle cx="47" cy="16" r="8" fill="#69b96d" stroke="#367e47" stroke-width="2"/><circle cx="50" cy="13" r="1.5" fill="#fff"/><circle cx="38" cy="42" r="4" fill="#e45a4f"/>',
 pong:'<rect x="6" y="8" width="52" height="48" rx="7" fill="#1f394c" stroke="#11293a" stroke-width="3"/><path d="M32 11v42" stroke="#c2d3df" stroke-width="2" stroke-dasharray="4 4"/><rect x="13" y="19" width="6" height="18" rx="2" fill="#f4f7f9"/><rect x="45" y="29" width="6" height="18" rx="2" fill="#f4f7f9"/><circle cx="33" cy="29" r="4.5" fill="#f4c94b"/>',
 contra:'<circle cx="32" cy="32" r="24" fill="#263f58" stroke="#162d42" stroke-width="3"/><circle cx="32" cy="32" r="15" fill="none" stroke="#7fc4eb" stroke-width="3"/><circle cx="32" cy="32" r="5" fill="#e65c4e"/><path d="M32 4v12M32 48v12M4 32h12M48 32h12" stroke="#f1c94c" stroke-width="3" stroke-linecap="round"/>',
 mario:'<path d="M10 35q0-17 15-21 7-8 15 0 14 4 14 21v5H10z" fill="#e84f4a" stroke="#9d2e31" stroke-width="3"/><path d="M15 38h34q-1 14-17 14T15 38z" fill="#f3e6c9" stroke="#bba47b" stroke-width="2"/><circle cx="23" cy="27" r="5" fill="#fff"/><circle cx="42" cy="27" r="5" fill="#fff"/><path d="M23 48h18" stroke="#b77b4b" stroke-width="3" stroke-linecap="round"/>',
 tank:'<path d="M130.613 43.002v66.926c-22.925 19.7-38.03 48.177-40.533 80.252h234.51c-2.666-34.175-19.637-64.265-45.133-84.006H149.303V43.002h-18.69zM472.62 58.738L431.09 69.865l16.504 61.588 41.525-11.127-16.5-61.588zm-54.042 36.627l-98.787 26.47c5.382 7.835 9.97 16.256 13.647 25.15l92.342-24.745-7.202-26.875zM121.53 206.342l-78.364 37.045.002 50.3 18.207-7.556H442.11l19.316 6.413c0-51.397-119.076-83.53-183.166-86.2H121.53zm-38.17 97.88v.038c-35.936.645-65.065 30.15-65.065 66.232 0 36.484 29.777 66.26 66.262 66.26 1.286 0 2.563-.046 3.832-.12h106.473c1.27.074 2.545.12 3.832.12s2.563-.046 3.832-.12h107.34c1.27.074 2.545.12 3.832.12 1.286 0 2.562-.046 3.83-.12H423.7c1.268.074 2.544.12 3.83.12 36.486 0 66.263-29.776 66.263-66.26 0-36.485-29.777-66.262-66.262-66.262-.276 0-.55.02-.827.022v-.03H83.36zm47.2 18.686h22.13c-4.283 4.144-8.012 8.855-11.063 14.014-3.05-5.16-6.78-9.87-11.066-14.014zm114.14 0h22.995c-4.49 4.344-8.37 9.313-11.498 14.766-3.13-5.453-7.006-10.422-11.498-14.766zm115.003 0h21.824c-4.21 4.074-7.89 8.692-10.912 13.748-3.022-5.056-6.7-9.674-10.912-13.748zm-275.146.012c26.385 0 47.572 21.187 47.572 47.572 0 25.293-19.477 45.798-44.333 47.45H83.36v.09c-25.825-.63-46.378-21.558-46.378-47.54 0-26.383 21.19-47.572 47.575-47.572zm114.138 0c26.386 0 47.573 21.187 47.573 47.572 0 25.293-19.476 45.798-44.332 47.45h-6.48c-24.858-1.652-44.335-22.157-44.335-47.45 0-26.383 21.19-47.572 47.575-47.572zm115.004 0c26.372 0 47.548 21.166 47.57 47.533v.078c-.02 25.276-19.487 45.76-44.33 47.413h-6.48c-24.858-1.653-44.335-22.158-44.335-47.45 0-26.384 21.19-47.573 47.574-47.573zm113.83 0c26.387 0 47.575 21.187 47.575 47.572 0 26.383-21.188 47.572-47.574 47.572-.277 0-.55-.016-.827-.02v-.1h-2.412c-24.843-1.653-44.31-22.138-44.33-47.413v-.078c.022-26.364 21.2-47.532 47.57-47.532zm-171.333 80.39c3.098 5.398 6.928 10.32 11.362 14.633h-22.724c4.434-4.312 8.264-9.235 11.36-14.632zm-114.572.75c3.02 5.106 6.702 9.77 10.93 13.883h-21.858c4.228-4.112 7.91-8.778 10.928-13.882zm228.99.266c2.99 5.002 6.62 9.576 10.776 13.617h-21.55c4.155-4.04 7.786-8.615 10.775-13.617z"/>',
 solitaire:'<rect x="8" y="9" width="32" height="44" rx="4" fill="#fff" stroke="#75899a" stroke-width="2.5" transform="rotate(-9 24 31)"/><rect x="27" y="7" width="29" height="44" rx="4" fill="#fff" stroke="#75899a" stroke-width="2.5" transform="rotate(8 41 29)"/><path d="M41 19l6 8-6 8-6-8z" fill="#d84e52"/><path d="M19 25l5 7-5 7-5-7z" fill="#397bb5"/>',
 doudizhu:'<rect x="8" y="12" width="28" height="40" rx="4" fill="#fff" stroke="#8397a8" stroke-width="2.5" transform="rotate(-12 22 32)"/><rect x="28" y="8" width="28" height="42" rx="4" fill="#fff" stroke="#8397a8" stroke-width="2.5" transform="rotate(10 42 29)"/><path d="M20 23l5 6-5 6-5-6z" fill="#397dbb"/><path d="M42 20c-5-6-12 1-6 7l6 6 6-6c6-6-1-13-6-7z" fill="#d84e52"/>',
 mahjong:'<rect x="9" y="6" width="46" height="52" rx="7" fill="#f8f4e9" stroke="#8b7655" stroke-width="3"/><rect x="14" y="11" width="36" height="42" rx="4" fill="#fffdf6" stroke="#c8b99b" stroke-width="1.5"/><path d="M22 20v20M32 18v24M42 20v20" stroke="#32885b" stroke-width="4" stroke-linecap="round"/><circle cx="22" cy="17" r="2.5" fill="#d74c4c"/><circle cx="42" cy="17" r="2.5" fill="#d74c4c"/>',
 sanguosha:'<path d="M13 12l9 2 26 28-5 5-28-26z" fill="#b7c8d5" stroke="#4a6277" stroke-width="2.5" stroke-linejoin="round"/><path d="M51 12l-9 2-26 28 5 5 28-26z" fill="#dce5ec" stroke="#4a6277" stroke-width="2.5" stroke-linejoin="round"/><path d="M10 10l10 2 3 7-7 3-7-3zM54 10l-10 2-3 7 7 3 7-3z" fill="#c49b4d" stroke="#7c5c2b" stroke-width="2"/><path d="M29 45l-7 9M35 45l7 9" stroke="#8d6036" stroke-width="4" stroke-linecap="round"/>'
};
function gameIconMarkup(game){
 const body=gameVectorArt[game.id]||gameVectorArt.gomoku;
 const tankClass=game.id==="tank"?" game-tank-icon":"";
 return '<svg class="game-vector-icon'+tankClass+'" viewBox="0 0 64 64" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">'+body+'</svg>';
}

function read(key,fallback){if(location.search.includes("p111Test=1")){try{const fixture=new URLSearchParams(location.search).get("p111State");if(fixture){const state=JSON.parse(fixture);if(Object.prototype.hasOwnProperty.call(state,key))return state[key];}}catch(e){}}try{const v=JSON.parse(localStorage.getItem(storePrefix+key));return v===null||v===undefined?fallback:v;}catch(e){return fallback;}}
function write(key,value){try{localStorage.setItem(storePrefix+key,JSON.stringify(value));return true;}catch(e){return false;}}
function normalizeStats(raw){const out={},known=new Set(games.map(g=>g.id));if(!raw||typeof raw!=="object"||Array.isArray(raw))return out;for(const [id,value] of Object.entries(raw)){if(!known.has(id)||!value||typeof value!=="object"||Array.isArray(value))continue;const days={};if(value.days&&typeof value.days==="object"&&!Array.isArray(value.days))for(const [day,ms] of Object.entries(value.days)){const n=Number(ms);if(/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(n)&&n>0)days[day]=Math.min(n,86400000);}const plays=Math.max(0,Math.floor(Number(value.plays)||0));out[id]={plays,wins:Math.min(plays,Math.max(0,Math.floor(Number(value.wins)||0))),totalMs:Math.max(0,Number(value.totalMs)||0),bestScore:Math.max(0,Number(value.bestScore)||0),lastPlayed:/^\d{4}-\d{2}-\d{2}$/.test(String(value.lastPlayed||""))?String(value.lastPlayed):"",lastPlayedAt:Math.max(0,Number(value.lastPlayedAt)||0),days};}return out;}
function normalizeFavorites(raw){const known=new Set(games.map(g=>g.id));return Array.isArray(raw)?[...new Set(raw.filter(id=>typeof id==="string"&&known.has(id)))]:[];}
function normalizeSettings(raw){const allowed=["1","1.08","1.16"];return {scale:allowed.includes(String(raw?.scale))?String(raw.scale):"1"};}
function dateKey(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
function fmtDuration(ms){const sec=Math.floor(Math.max(0,ms)/1000),h=Math.floor(sec/3600),m=Math.floor(sec%3600/60);return h?h+"小时"+m+"分":m+"分";}
function fmtClock(ms){const sec=Math.floor(ms/1000),m=Math.floor(sec/60),s=sec%60;return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
let centerNoticeTimer=null,permanentGameStatus="";
function setGameNoticeText(value){
 const box=$("gameNotice"),label=$("gameNoticeText"),viewport=box?.querySelector(".game-notice-window");
 if(!box||!label||!viewport)return;
 label.textContent=value;box.classList.toggle("visible",!!value);box.classList.remove("marquee");
 label.style.removeProperty("--led-shift");label.style.removeProperty("--led-duration");
 if(!value)return;
 const overflow=label.scrollWidth-viewport.clientWidth;
 if(overflow>2){
  label.style.setProperty("--led-shift",Math.ceil(overflow+8)+"px");
  label.style.setProperty("--led-duration",Math.max(5,Math.min(15,overflow/26+3))+"s");
  box.classList.add("marquee");
 }
}
function showGameNotice(message,timeout=2400,persistent=false){
 const value=String(message||"").trim();if(!value)return;
 if(persistent)permanentGameStatus=value;
 clearTimeout(centerNoticeTimer);setGameNoticeText(value);
 // Restart the two-pulse animation for every incoming message, even if identical.
 const speaker=$("gameNotice")?.querySelector(".game-notice-speaker");
 if(speaker){speaker.classList.remove("is-pulsing");void speaker.getBoundingClientRect().width;speaker.classList.add("is-pulsing");}
 if(timeout>0)centerNoticeTimer=setTimeout(()=>setGameNoticeText(permanentGameStatus),timeout);
}
function clearGameNotice(){clearTimeout(centerNoticeTimer);permanentGameStatus="";setGameNoticeText("");}
function toast(message){const el=$("toast");if(active){el.classList.remove("show");showGameNotice(message);return;}el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),1900);}
let stats=normalizeStats(read("stats",{})),settings=normalizeSettings(read("settings",{scale:"1"})),favorites=new Set(normalizeFavorites(read("favorites",[]))),firstStartedAt=Math.max(0,Number(read("firstStartedAt",0))||0);
let active=null,sessionId=null,ready=false,paused=true,started=false,roundCounted=false,modeIndex=0,difficulty="normal",currentScore=0,session=null,currentCategory="all",search="",rankingType="score",lastHomeDay="",railCollapsed=false,heatmapObserver=null,helpSource={lines:[],note:""},homeRecentTab="recent",posterIndex=0,selectedPosterId="";

const scoringGames=new Set(["2048","memory","tetris","snake","pong","contra","mario","tank","doudizhu","mahjong","sanguosha"]);
const nativeResultGames=new Set(["gomoku","xiangqi"]);
function hideGameResult(){const el=$("gameResultOverlay");el.hidden=true;el.setAttribute("aria-hidden","true");}
function showGameResult(payload={},manual=false){
 if(!active)return;
 const el=$("gameResultOverlay"),card=$("gameResultCard"),score=Number(payload.score??session?.score??currentScore);
 const raw=String(payload.message||"").trim();
 const hasTwoPlayerMode=!!active.modes?.some(label=>label==="本机双人"||label==="本机多人");
 const localDuel=hasTwoPlayerMode&&["本机双人","本机多人"].includes(active.modes[modeIndex]);
 const draw=!manual&&(payload.draw===true||/平局|和棋/.test(raw));
 const side=String(payload.winner||"").trim()||
  raw.match(/(黑色棋子|白色棋子|黑方|白方|红方|黄方|蓝方|绿方)(?:将死)?获胜/)?.[1]||"";
 let title=manual?"本局结束":payload.win===true?"本局获胜":"本局结束";
 let message=manual?"本局已结束，可以再来一局或离开":raw||"本局已结束";
 let result=manual?"ended":payload.win===true?"win":payload.win===false?"loss":"ended";
 if(hasTwoPlayerMode&&!manual){
  if(draw){title="平局";message="双方战成平局，可以再来一局";result="draw";}
  else if(localDuel){
   title=side?side+"获胜":"本局结束";
   message=side?side+"取得胜利，可以再来一局":message;
   result=side?"win":"ended";
  }else{
   title=payload.win===true?"获胜":payload.win===false?"失败":"本局结束";
   message=payload.win===true?"恭喜获胜！可以再来一局":
    payload.win===false?"本局失败，再挑战一次":message;
   result=payload.win===true?"win":payload.win===false?"loss":"ended";
  }
 }
 card.dataset.result=result;
 $("gameResultTitle").textContent=title;
 $("gameResultMessage").textContent=message;
 $("gameResultScore").hidden=!scoringGames.has(active.id);
 $("gameResultScoreLabel").textContent=active.id==="doudizhu"?"本局结算":"本局得分";
 $("gameResultScoreValue").textContent=String(Number.isFinite(score)?score:0);
 el.hidden=false;el.setAttribute("aria-hidden","false");
}
function statFor(id){if(!stats[id])stats[id]={plays:0,wins:0,totalMs:0,bestScore:0,lastPlayed:"",lastPlayedAt:0,days:{}};const s=stats[id];s.plays=Number(s.plays)||0;s.wins=Number(s.wins)||0;s.totalMs=Number(s.totalMs)||0;s.bestScore=Number(s.bestScore)||0;s.lastPlayedAt=Math.max(0,Number(s.lastPlayedAt)||0);s.days=s.days||{};return s;}
function persistStats(){write("stats",stats);}
function applySettings(){document.documentElement.style.setProperty("--ui-scale",String(settings.scale||"1"));$("uiScale").value=String(settings.scale||"1");}
function inferFirstStartedAt(){
 const keys=Object.values(stats).flatMap(s=>[...Object.entries(s.days||{}).filter(([,ms])=>Number(ms)>0).map(([day])=>day),...(s.lastPlayed?[s.lastPlayed]:[])])
  .filter(day=>/^\d{4}-\d{2}-\d{2}$/.test(day)).sort();
 if(!keys.length)return 0;
 const [year,month,day]=keys[0].split("-").map(Number);
 return new Date(year,month-1,day).getTime();
}
function statPlayedAt(stat){
 if(Number(stat?.lastPlayedAt)>0)return Number(stat.lastPlayedAt);
 const match=String(stat?.lastPlayed||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
 return match?new Date(Number(match[1]),Number(match[2])-1,Number(match[3]),12).getTime():0;
}
function metricDate(timestamp,withTime=false){
 if(!timestamp)return "—";
 const date=new Date(timestamp),day=(date.getMonth()+1)+"月"+date.getDate()+"日";
 return withTime?day+" "+date.toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false}):date.getFullYear()+"."+String(date.getMonth()+1).padStart(2,"0")+"."+String(date.getDate()).padStart(2,"0");
}
function renderHomeMetrics(){
 const today=dateKey(new Date()),values=Object.values(stats);
 const days=[...new Set(values.flatMap(s=>Object.entries(s.days||{}).filter(([,ms])=>Number(ms)>0).map(([key])=>key)))].sort();
 const first=firstStartedAt||inferFirstStartedAt();
 const recent=games.map(game=>({game,stat:stats[game.id]||{plays:0,lastPlayed:"",lastPlayedAt:0}}))
  .filter(row=>row.stat.plays>0||row.stat.lastPlayed)
  .sort((a,b)=>statPlayedAt(b.stat)-statPlayedAt(a.stat)||b.stat.plays-a.stat.plays)[0];
 const total=values.reduce((sum,s)=>sum+Math.max(0,Number(s.totalMs)||0),0);
 const todayTotal=values.reduce((sum,s)=>sum+Math.max(0,Number(s.days?.[today])||0),0);
 const set=(id,value)=>{const el=$(id);if(el)el.textContent=value;};
 set("heroFirstPlayed",first?metricDate(first):"尚未开始");
 set("heroLastGame",recent?recent.game.name:"暂无记录");
 set("heroLastGameMeta",recent?(Number(recent.stat.lastPlayedAt)>0?metricDate(statPlayedAt(recent.stat),true):metricDate(statPlayedAt(recent.stat))):"开始一局后记录");
 set("heroActiveDays",days.length+" 天");
 set("heroTotalTime",fmtDuration(total));
 set("heroTodayTime",fmtDuration(todayTotal));
}
function updateHomeClock(){
 const now=new Date(),key=dateKey(now);
 $("homeDate").textContent=(now.getMonth()+1)+"月"+now.getDate()+"日 · 星期"+["日","一","二","三","四","五","六"][now.getDay()];
 $("homeTime").textContent=now.toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false});
 if(key!==lastHomeDay){lastHomeDay=key;renderHeatmap();renderRanking();}
 renderHomeMetrics();
}
function renderHeatmap(){
 const grid=$("heatmapGrid"),months=$("heatmapMonths");grid.innerHTML="";months.innerHTML="";
 const today=new Date();today.setHours(0,0,0,0);
 const start=new Date(today);start.setDate(start.getDate()-364);
 const leading=(start.getDay()+6)%7;
 for(let i=0;i<leading;i++){const blank=document.createElement("span");blank.className="heatmap-cell empty";blank.setAttribute("aria-hidden","true");grid.appendChild(blank);}
 let total=0,activeDays=0;
 for(let offset=0;offset<365;offset++){
  const date=new Date(start);date.setDate(start.getDate()+offset);const key=dateKey(date);
  const ms=Object.values(stats).reduce((sum,s)=>sum+Number(s.days?.[key]||0),0);
  total+=ms;if(ms>0)activeDays++;
  const minutes=Math.round(ms/60000),level=minutes<=0?0:minutes<15?1:minutes<45?2:minutes<90?3:4;
  const cell=document.createElement("span");cell.className="heatmap-cell level-"+level;cell.dataset.date=key;
  cell.title=key+" · "+(minutes?minutes+" 分钟":"无游戏记录");cell.setAttribute("aria-label",cell.title);grid.appendChild(cell);
  if(date.getDate()===1||offset===0){const label=document.createElement("span");label.textContent=(date.getMonth()+1)+"月";label.dataset.column=String(Math.floor((leading+offset)/7));months.appendChild(label);}
 }
 grid.dataset.weeks=String(Math.ceil((leading+365)/7));
 $("activitySummary").textContent=activeDays+" 天有记录 · "+fmtDuration(total);
 resizeHeatmap();
}
function resizeHeatmap(){
 const grid=$("heatmapGrid"),content=grid?.parentElement,layout=grid?.closest(".heatmap-layout");
 if(!grid||!content||!layout)return;
 const weeks=Number(grid.dataset.weeks)||53;
 // Distribute all weeks over the visible width, retaining square cells and a
 // steady gap. The previous fixed 11px size wasted the right side of the panel.
 const available=Math.max(0,content.getBoundingClientRect().width);
 const narrow=window.innerWidth<=700;
 const gap=narrow?2:(available<850?2:3);
 const cell=Math.max(1,Math.floor(Math.max(0,(available-(weeks-1)*gap)/weeks)*100)/100);
 layout.style.setProperty("--heat-cell",cell+"px","important");
 layout.style.setProperty("--heat-gap",gap+"px","important");
 grid.style.setProperty("--heat-cell",cell+"px","important");
 grid.style.setProperty("--heat-gap",gap+"px","important");
 grid.dataset.availableWidth=String(available);
 grid.dataset.cellSize=String(cell);
 const gridWidth=weeks*cell+(weeks-1)*gap;
 const months=$("heatmapMonths"),legend=content.querySelector(".heatmap-legend");
 grid.style.width=gridWidth+"px";
 months.style.width=gridWidth+"px";if(legend)legend.style.width=gridWidth+"px";
 months.querySelectorAll("[data-column]").forEach(label=>{label.style.left=(Number(label.dataset.column)*(cell+gap))+"px";});
}
function rankingValue(s,type){if(type==="time")return s.totalMs;if(type==="plays")return s.plays;return s.bestScore;}
function renderRanking(){
 const list=$("rankingList");list.innerHTML="";
 const rows=games.map(g=>({game:g,stat:statFor(g.id)})).filter(x=>rankingValue(x.stat,rankingType)>0)
  .sort((a,b)=>rankingValue(b.stat,rankingType)-rankingValue(a.stat,rankingType)||b.stat.wins-a.stat.wins||b.stat.plays-a.stat.plays).slice(0,10);
 $("rankingEmpty").classList.toggle("hidden",rows.length>0);
 rows.forEach((x,i)=>{
  const li=document.createElement("li");li.className="ranking-row";
  const value=rankingType==="time"?fmtDuration(x.stat.totalMs):rankingType==="plays"?x.stat.plays+" 次":x.stat.bestScore.toLocaleString("zh-CN");
  const button=document.createElement("button");button.type="button";button.className="ranking-open";button.setAttribute("aria-label","打开"+x.game.name);
  const rank=i<3?'<span class="ranking-rank ranking-medal" aria-label="第'+(i+1)+'名">'+["🥇","🥈","🥉"][i]+'</span>':'<span class="ranking-rank">'+String(i+1).padStart(2,"0")+'</span>';
  button.innerHTML=rank+'<span class="ranking-name" title="'+escapeHtml(x.game.name)+'">'+escapeHtml(x.game.name)+'</span><span class="ranking-value">'+value+'</span>';
  button.addEventListener("click",()=>openGame(x.game.id));li.appendChild(button);list.appendChild(li);
 });
}
function getPlayedRows(){
 return games.map(game=>({game,stat:stats[game.id]||{plays:0,totalMs:0,lastPlayed:"",lastPlayedAt:0}}))
  .filter(row=>row.stat.plays>0||row.stat.lastPlayed);
}
function recentRows(){
 const rows=getPlayedRows();
 rows.sort(homeRecentTab==="popular"?
  (a,b)=>b.stat.plays-a.stat.plays||b.stat.totalMs-a.stat.totalMs||statPlayedAt(b.stat)-statPlayedAt(a.stat):
  (a,b)=>statPlayedAt(b.stat)-statPlayedAt(a.stat)||b.stat.plays-a.stat.plays);
 return rows.slice(0,9);
}
function renderHomeRecent(){
 const list=$("homeRecentList");if(!list)return;
 document.querySelectorAll("[data-recent-tab]").forEach(b=>{
  const on=b.dataset.recentTab===homeRecentTab;b.classList.toggle("is-active",on);b.setAttribute("aria-selected",String(on));
 });
 const rows=recentRows();list.replaceChildren();
 if(!rows.length){
  const empty=document.createElement("div");empty.className="recent-empty";
  empty.textContent="还没有游玩记录，玩过的游戏会显示在这里";list.appendChild(empty);return;
 }
 rows.forEach(({game})=>{
  const button=document.createElement("button");button.type="button";button.className="recent-game";
  button.title="预览 "+game.name;button.setAttribute("aria-label","预览 "+game.name);
  button.dataset.game=game.id;button.setAttribute("aria-pressed",String(selectedPosterId===game.id));
  button.innerHTML='<span class="recent-icon" data-category="'+game.category+'" data-game="'+game.id+'" aria-hidden="true">'+gameIconMarkup(game)+'</span><span class="recent-copy"><strong>'+escapeHtml(game.name)+'</strong></span>';
  button.addEventListener("click",()=>{
   selectedPosterId=game.id;const i=posterGames().findIndex(g=>g.id===game.id);if(i>=0)posterIndex=i;
   document.querySelectorAll("#homeRecentList .recent-game").forEach(item=>item.setAttribute("aria-pressed",String(item.dataset.game===game.id)));
   renderHomePoster();
  });
  button.addEventListener("dblclick",()=>openGame(game.id));
  list.appendChild(button);
 });
}
const posterPriority=["gomoku","xiangqi","minesweeper","tetris","tank","mario","solitaire","mahjong"];
function posterGames(){
 const seen=new Set(),out=[];
 const selected=games.find(g=>g.id===selectedPosterId);
 const ordered=[...(selected?[selected]:[]),
  ...getPlayedRows().sort((a,b)=>statPlayedAt(b.stat)-statPlayedAt(a.stat)).map(r=>r.game),
  ...posterPriority.map(id=>games.find(g=>g.id===id)).filter(Boolean)];
 for(const game of ordered)if(!seen.has(game.id)){seen.add(game.id);out.push(game);}
 return out.slice(0,8);
}
function renderHomePoster(){
 const poster=$("homeGamePoster"),rows=posterGames();if(!poster||!rows.length)return;
 if(selectedPosterId){const selected=rows.findIndex(g=>g.id===selectedPosterId);if(selected>=0)posterIndex=selected;}
 posterIndex=(posterIndex%rows.length+rows.length)%rows.length;
 const game=rows[posterIndex];selectedPosterId=game.id;
 poster.dataset.category=game.category;poster.dataset.game=game.id;poster.dataset.posterIndex=String(posterIndex);
 $("homePosterArt").innerHTML=gameIconMarkup(game);
 $("homePosterCategory").textContent=game.categoryName||categoryNames[game.category]||"游戏";
 $("homePosterTitle").textContent=game.name;$("homePosterDescription").textContent=game.description;
 $("homePosterTip").textContent=game.tip||"点击进入游戏，查看完整玩法。";
 $("homePosterCount").textContent=String(posterIndex+1).padStart(2,"0")+" / "+String(rows.length).padStart(2,"0");
 $("homePosterDots").replaceChildren(...rows.map((g,i)=>{const x=document.createElement("i");if(i===posterIndex)x.className="active";return x;}));

 poster.classList.remove("arriving");void poster.offsetWidth;poster.classList.add("arriving");
 document.querySelectorAll("#homeRecentList .recent-game").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.game===game.id)));
}
function rotateHomePoster(){
 const poster=$("homeGamePoster");if(homeView.classList.contains("hidden")||poster?.matches(":hover"))return;
 const rows=posterGames();if(rows.length<2)return;selectedPosterId="";posterIndex=(posterIndex+1)%rows.length;renderHomePoster();
}

function updateCounts(){for(const cat of Object.keys(categoryNames))$("count-"+cat).textContent=games.filter(g=>cat==="all"||g.category===cat).length;if($("totalGameCount"))$("totalGameCount").textContent=String(games.length);["board","puzzle","arcade","card"].forEach(cat=>{const el=$("homeCount-"+cat);if(el)el.textContent=games.filter(g=>g.category===cat).length+" 款";});}
function showHome(){closeGame();homeView.classList.remove("hidden");libraryView.classList.add("hidden");workspaceView.classList.add("hidden");$("breadcrumbCategory").textContent="首页";$("crumbGameSep").classList.add("hidden");$("breadcrumbGame").classList.add("hidden");$("gameControls").classList.add("hidden");$("gameActions").classList.add("hidden");$("helpButton").classList.add("hidden");document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view==="home"));shell.classList.remove("menu-open");updateHomeClock();renderHeatmap();renderRanking();renderHomeRecent();renderHomePoster();renderHomeMetrics();}
function showLibrary(category){closeGame();currentCategory=category||"all";homeView.classList.add("hidden");libraryView.classList.remove("hidden");workspaceView.classList.add("hidden");$("breadcrumbCategory").textContent=categoryNames[currentCategory]||"全部游戏";$("crumbGameSep").classList.add("hidden");$("breadcrumbGame").classList.add("hidden");$("gameControls").classList.add("hidden");$("gameActions").classList.add("hidden");$("libraryTitle").textContent=categoryNames[currentCategory]||"全部游戏";document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.category===currentCategory));renderLibrary();shell.classList.remove("menu-open");}
function renderLibrary(){const grid=$("gameGrid");grid.innerHTML="";const rows=games.filter(g=>(currentCategory==="all"||g.category===currentCategory)&&(!search||(g.name+" "+g.description).toLowerCase().includes(search)));$("libraryCount").textContent=rows.length+" 款";$("emptyState").classList.toggle("hidden",rows.length>0);rows.forEach(g=>{const b=document.createElement("button");b.className="game-card";b.type="button";b.innerHTML='<span class="game-card-icon" data-category="'+g.category+'" data-game="'+g.id+'" aria-hidden="true">'+gameIconMarkup(g)+'</span><span class="game-card-copy"><strong class="game-card-title">'+escapeHtml(g.name)+'</strong><span class="game-card-meta"><i class="game-card-status '+(g.status==="prototype"?"prototype":"")+'"></i>'+(g.status==="prototype"?"持续完善":"可直接游玩")+'</span></span><span class="game-card-arrow">›</span>';b.addEventListener("click",()=>openGame(g.id));grid.appendChild(b);});}
function send(type,payload={}){if(!active||!frame.contentWindow)return;frame.contentWindow.postMessage({channel:"gamestation",protocolVersion:1,gameId:active.id,sessionId,type,payload},"*");}
function setBreadcrumb(){
 $("breadcrumbCategory").textContent=active.name;
 $("breadcrumbCategory").title=active.name;
 $("crumbGameSep").classList.add("hidden");
 $("breadcrumbGame").classList.add("hidden");
}
function renderGameControls(){
 const modeEl=$("modeControl"),difficultyEl=$("difficultyControl"),hasModes=Array.isArray(active?.modes)&&active.modes.length>1;
 modeEl.classList.toggle("hidden",!hasModes);modeEl.innerHTML="";
 // Battleship implements AI-only play: remove the unused mode placeholder entirely.
 if(active?.id==="battleship"){
  modeEl.hidden=true;modeEl.setAttribute("aria-hidden","true");
  modeEl.style.setProperty("display","none","important");
 }else{
  modeEl.hidden=!hasModes;modeEl.removeAttribute("aria-hidden");
  modeEl.style.removeProperty("display");
 }
 if(hasModes)active.modes.forEach((label,index)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.dataset.modeIndex=String(index);b.setAttribute("aria-pressed",String(index===modeIndex));modeEl.appendChild(b);});
 const hasDifficulty=!!active?.difficulty,locked=hasModes&&["本机双人","本机多人"].includes(active.modes[modeIndex]);
 difficultyEl.classList.toggle("hidden",!hasDifficulty);difficultyEl.classList.toggle("is-inactive",locked);
 difficultyEl.setAttribute("aria-disabled",String(locked));difficultyEl.title=locked?"双人对战不需要 AI 难度":"";difficultyEl.innerHTML="";
 if(hasDifficulty){const labels=active.difficultyLabels||["简单","中等","困难"],values=["easy","normal","hard"];labels.forEach((label,index)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.dataset.difficulty=values[index]||"hard";b.disabled=locked;b.setAttribute("aria-pressed",String((values[index]||"hard")===difficulty));difficultyEl.appendChild(b);});}
 $("gameControls").classList.toggle("hidden",!hasModes&&!hasDifficulty);
}
function setGameState(){
 $("gameElapsed").textContent=session?fmtClock(session.elapsedMs):"00:00";
 const finished=!!session?.finished,startLabel=started?"结束":"开始",pauseLabel=started&&!finished&&paused?"继续":"暂停";
 $("startButton").innerHTML=started?icons.stop:icons.play;$("startButton").setAttribute("aria-label",startLabel);$("startButton").title=startLabel;
 $("startButton").classList.toggle("end-action",started);$("startButton").disabled=!ready||finished||(!started&&!paused);
 $("pauseButton").innerHTML=started&&!finished&&paused?icons.resume:icons.pause;$("pauseButton").setAttribute("aria-label",pauseLabel);$("pauseButton").title=pauseLabel;$("pauseButton").classList.toggle("continue-action",started&&!finished&&paused);
 $("pauseButton").disabled=!ready||!started||finished;
 const overlay=$("gamePauseOverlay"),visible=!!active&&ready&&started&&paused&&!finished;
 overlay.hidden=!visible;overlay.setAttribute("aria-hidden",String(!visible));
 $("newGameButton").innerHTML=icons.next;$("newGameButton").setAttribute("aria-label","下一局");$("newGameButton").title="下一局";$("newGameButton").disabled=!ready;
 if(active&&ready)send("HUD_STATE",{ready,started,paused,finished,elapsed:session?fmtClock(session.elapsedMs):"00:00",modeIndex,difficulty});
}
function persistSessionTime(){if(!session||!session.running)return;const now=Date.now(),delta=Math.max(0,now-session.lastTick);session.lastTick=now;session.elapsedMs+=delta;const s=statFor(session.id),key=dateKey(new Date(now));s.totalMs+=delta;s.days[key]=(Number(s.days[key])||0)+delta;}
function startClock(){if(!session||session.running)return;session.running=true;session.lastTick=Date.now();started=true;paused=false;setGameState();}
function stopClock(){if(session&&session.running){persistSessionTime();session.running=false;persistStats();renderHeatmap();renderRanking();}paused=true;setGameState();}
function updateSessionDisplay(){if(session&&session.running){persistSessionTime();$("gameElapsed").textContent=fmtClock(session.elapsedMs);if(active&&ready)send("HUD_STATE",{ready,started,paused,finished:!!session?.finished,elapsed:fmtClock(session.elapsedMs),modeIndex,difficulty});if(Date.now()-session.lastSave>5000){session.lastSave=Date.now();persistStats();}}}
function countRound(){if(!session||roundCounted)return;const now=Date.now(),s=statFor(session.id);if(!firstStartedAt){firstStartedAt=inferFirstStartedAt()||now;write("firstStartedAt",firstStartedAt);}s.plays++;s.lastPlayed=dateKey(new Date(now));s.lastPlayedAt=now;roundCounted=true;persistStats();renderRanking();renderHomeRecent();renderHomePoster();renderHomeMetrics();}
function startGame(){if(!ready||!paused||started||session?.finished)return;if(session?.needsInit){send("NEW_GAME");session.needsInit=false;}if(!roundCounted)countRound();send("RESUME");startClock();focusGameFrame();toast("开始游戏");}
function endGame(){if(!ready||!started||session?.finished)return;if(!paused)send("PAUSE");stopClock();session.finished=true;persistStats();setGameState();showGameNotice("已结束",0,true);showGameResult({},true);}
function pauseGame(){if(!ready||!started||paused||session?.finished)return;send("PAUSE");stopClock();toast("已暂停");}
function resumeGame(){if(!ready||!started||!paused||session?.finished)return;send("RESUME");startClock();focusGameFrame();toast("继续游戏");}
function togglePause(){if(paused)resumeGame();else pauseGame();}
function toggleGamePause(){if(!ready||session?.finished)return;if(!started){startGame();return;}togglePause();}
function startOrResumeGame(){if(!ready||session?.finished)return;if(started){if(paused)resumeGame();return;}startGame();}
function focusGameFrame(){
 try{frame.focus({preventScroll:true});frame.contentWindow?.focus();}
 catch{frame.focus();}
}
function newRound(){
 if(!ready||!session)return;
 hideGameResult();clearGameNotice();
 stopClock();session.elapsedMs=0;session.finished=false;session.score=0;session.lastSave=Date.now();session.needsInit=false;
 currentScore=0;started=false;roundCounted=false;paused=true;
 send("NEW_GAME");send("RESUME");countRound();startClock();focusGameFrame();setGameState();renderGameControls();
}
function finishGame(payload={}){if(!session||session.finished)return;stopClock();session.finished=true;
 const score=Number(payload.score??session.score);if(scoringGames.has(session.id)&&Number.isFinite(score))session.score=score;
 const s=statFor(session.id);if(Number.isFinite(Number(payload.score)))s.bestScore=Math.max(s.bestScore,Number(payload.score));
 const msg=String(payload.message||"");if((typeof payload.win==="boolean"?payload.win:!payload.draw&&/获胜|胜利|通关|完成|挑战成功|你赢/.test(msg)))s.wins++;
 persistStats();renderHeatmap();renderRanking();renderHomeRecent();renderHomePoster();renderHomeMetrics();setGameState();
 if(!nativeResultGames.has(session.id))showGameResult({...payload,score:session.score});
}
function openGame(id){
 const g=games.find(x=>x.id===id);if(!g)return;closeGame();active=g;
 sessionId=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():"gs-"+Date.now()+"-"+Math.random().toString(16).slice(2);
 ready=false;paused=true;started=false;roundCounted=false;modeIndex=0;difficulty="normal";currentScore=0;railCollapsed=false;helpSource={lines:[],note:""};hideGameResult();
 session={id:g.id,elapsedMs:0,lastTick:0,lastSave:Date.now(),running:false,finished:false,score:0,needsInit:true};
 setBreadcrumb();$("gameActions").classList.remove("hidden");$("helpButton").classList.remove("hidden");
 renderGameControls();$("startButton").disabled=true;$("newGameButton").disabled=true;$("pauseButton").disabled=true;
 $("gameElapsed").textContent="00:00";$("hostGameTimer").classList.remove("hidden");$("gameNotice").classList.remove("hidden");clearGameNotice();$("helpTitle").textContent=g.name+" · 玩法";
 homeView.classList.add("hidden");libraryView.classList.add("hidden");workspaceView.classList.remove("hidden");
 $("stageLoading").classList.remove("done");frame.title=g.name+" 游戏";frame.src=g.entry+(g.id==="gomoku"&&location.search.includes("p111Test=1")?"?p111Test=1":"");closeHelp();shell.classList.remove("menu-open");
}
function closeGame(){hideGameResult();if(active){if(ready){if(!paused)send("PAUSE");send("DISPOSE");}if(session?.running)stopClock();if(session)persistStats();frame.src="about:blank";}active=null;session=null;ready=false;paused=true;started=false;if(gameFullscreenRequested){gameFullscreenRequested=false;syncGameFullscreen();}$("gamePauseOverlay").hidden=true;$("gamePauseOverlay").setAttribute("aria-hidden","true");$("hostGameTimer").classList.add("hidden");$("gameControls").classList.add("hidden");$("gameActions").classList.add("hidden");$("helpButton").classList.add("hidden");clearGameNotice();$("gameNotice").classList.add("hidden");}
window.addEventListener("message",event=>{
 if(!active||event.source!==frame.contentWindow)return;
 const m=event.data;
 if(!m||m.channel!=="gamestation"||m.protocolVersion!==1||m.gameId!==active.id)return;
 if(m.type==="READY"&&!ready){
  ready=true;
  send("INIT",{sessionId,mode:["本机双人","本机多人"].includes(active.modes?.[modeIndex])?"two":"ai",difficulty,name:active.name,modes:active.modes||[],hasDifficulty:!!active.difficulty,difficultyLabels:active.difficultyLabels||["简单","中等","困难"]});
  send("PAUSE");
  paused=true;
  setGameState();
  $("stageLoading").classList.add("done");
  send("SET_RAIL",{collapsed:railCollapsed});
  return;
 }
 if(m.sessionId!==sessionId)return;
 if(m.type==="HOTKEY"){if(started&&!session?.finished&&["toggle","pause","start"].includes(m.payload?.action))togglePause();return;}
 if(m.type==="ACTIVITY"){if(!started)startGame();else if(paused)resumeGame();return;}
 
if(m.type==="CONTROL"){const action=m.payload?.action;if(action==="start"){if(started)endGame();else startGame();}else if(action==="toggle")toggleGamePause();else if(action==="new")newRound();else if(action==="leave")showLibrary(active.category);else if(action==="mode")setMode(m.payload?.index);else if(action==="difficulty")setDifficulty(m.payload?.value);else if(action==="help")openHelp();return;}
 if(m.type==="TOOLS_STATE"){railCollapsed=!m.payload?.expanded;return;}
 if(m.type==="TOOLS_META"){
  const hasActions=!!m.payload?.hasActions;railCollapsed=!hasActions;
  send("SET_RAIL",{collapsed:!hasActions});return;
 }
  if(m.type==="HELP_SOURCE"){helpSource={lines:m.payload?.lines||[],note:m.payload?.note||""};if(!$("helpPanel").classList.contains("hidden"))renderHelp();return;}
 if(m.type==="REQUEST_NEW_GAME"){newRound();return;}
 if(m.type==="STATE"){
  if(session.finished)return;
  if(Number.isFinite(Number(m.payload?.score))){
   currentScore=Number(m.payload.score);
   session.score=currentScore;
   const s=statFor(active.id);
   s.bestScore=Math.max(s.bestScore,currentScore);
  }
  if(typeof m.payload?.status==="string"&&m.payload.status.trim()){setGameState();showGameNotice(m.payload.status,0,true);}
  if(m.payload?.score!==undefined)persistStats();
 }else if(m.type==="SCORE"){
  const score=Number(m.payload?.score);
  if(Number.isFinite(score)){
   currentScore=score;
   session.score=score;
   const s=statFor(active.id);
   s.bestScore=Math.max(s.bestScore,score);
   persistStats();
   renderRanking();
  }
 }else if(m.type==="GAME_OVER"){
  finishGame(m.payload||{});
  showGameNotice("已结束"+(m.payload?.message?" · "+m.payload.message:""),0,true);
 }else if(m.type==="ERROR"){
  showGameNotice(m.payload?.message||"游戏模块发生错误",0,true);
 }
});
function setMode(index){if(!active?.modes||active.modes.length<2)return;const next=Math.max(0,Math.min(active.modes.length-1,Number(index)));if(next===modeIndex)return;modeIndex=next;renderGameControls();send("SET_MODE",{mode:["本机双人","本机多人"].includes(active.modes[modeIndex])?"two":"ai"});newRound();}
function setDifficulty(value){if(!active?.difficulty||["本机双人","本机多人"].includes(active.modes?.[modeIndex])||!["easy","normal","hard"].includes(value)||value===difficulty)return;difficulty=value;renderGameControls();send("SET_DIFFICULTY",{difficulty});newRound();}
function renderHelp(){const content=$("helpContent");content.innerHTML="";const chapters=active?[["快捷键","Enter：暂停 / 继续；P：暂停 / 继续。游戏区域右键由游戏接管。"],...active.help,...(helpSource.lines.length?[["游戏专用快捷键与鼠标",helpSource.lines.join("；")]]:[]),...(helpSource.note?[["游戏操作提醒",helpSource.note]]:[])]:[["离线运行","所有游戏均在本机浏览器中运行，不需要账号、服务器或网络连接。"],["游戏导航","左侧按棋类、益智、街机和卡牌分类浏览游戏。"],["成绩与记录","首页热力图和排行榜只读取当前浏览器中的本地游戏记录。"],["数据备份","在左下角全局设置中导出或导入 JSON 备份。"]];chapters.forEach((item,i)=>{const section=document.createElement("section");section.className="help-chapter";const button=document.createElement("button");button.type="button";button.innerHTML='<span>'+escapeHtml(item[0])+'</span><span>'+(i===0?"−":"＋")+'</span>';const p=document.createElement("p");p.textContent=item[1];p.hidden=i!==0;button.addEventListener("click",()=>{p.hidden=!p.hidden;button.querySelector("span:last-child").textContent=p.hidden?"＋":"−";});section.append(button,p);content.appendChild(section);});}
function openHelp(){renderHelp();$("helpPanel").classList.remove("hidden");}
function closeHelp(){$("helpPanel").classList.add("hidden");}
function dragHelp(){const panel=$("helpPanel"),header=$("helpHeader");let dragging=false,startX=0,startY=0,left=0,top=0;header.addEventListener("pointerdown",e=>{if(e.target.closest("button"))return;dragging=true;const r=panel.getBoundingClientRect();left=r.left;top=r.top;startX=e.clientX;startY=e.clientY;panel.style.left=left+"px";panel.style.top=top+"px";panel.style.right="auto";header.setPointerCapture(e.pointerId);});header.addEventListener("pointermove",e=>{if(!dragging)return;const x=Math.max(8,Math.min(window.innerWidth-panel.offsetWidth-8,left+e.clientX-startX));const y=Math.max(8,Math.min(window.innerHeight-48,top+e.clientY-startY));panel.style.left=x+"px";panel.style.top=y+"px";});header.addEventListener("pointerup",()=>dragging=false);header.addEventListener("pointercancel",()=>dragging=false);}
function openSettings(){$("settingsBackdrop").classList.remove("hidden");applySettings();}
function closeSettings(){$("settingsBackdrop").classList.add("hidden");}
function exportData(){const payload={app:"GameStation",schemaVersion:2,appVersion:"1.1",exportedAt:new Date().toISOString(),firstStartedAt:firstStartedAt||inferFirstStartedAt(),stats:normalizeStats(stats),favorites:normalizeFavorites([...favorites]),settings:normalizeSettings(settings)};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="gamestation-backup-"+dateKey(new Date())+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast("本地 JSON 备份已生成");}
function importData(file){const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(String(reader.result));if(!data||data.app!=="GameStation"||![1,2].includes(Number(data.schemaVersion))||!data.stats||typeof data.stats!=="object"||Array.isArray(data.stats))throw new Error("格式不正确");if(!confirm("导入备份将替换本机现有的游戏记录、收藏和界面设置。建议先导出当前数据。继续吗？"))return;const nextStats=normalizeStats(data.stats),nextFavorites=normalizeFavorites(data.favorites),nextSettings=normalizeSettings(data.settings);if(!write("stats",nextStats)||!write("favorites",nextFavorites)||!write("settings",nextSettings))throw new Error("本地存储写入失败");stats=nextStats;firstStartedAt=Math.max(0,Number(data.firstStartedAt)||0)||inferFirstStartedAt();if(firstStartedAt)write("firstStartedAt",firstStartedAt);else try{localStorage.removeItem(storePrefix+"firstStartedAt");}catch(e){}favorites=new Set(nextFavorites);settings=nextSettings;applySettings();renderHeatmap();renderRanking();renderHomeRecent();renderHomePoster();renderHomeMetrics();toast("备份已恢复到当前浏览器");}catch(e){toast("备份文件无效、损坏或版本不兼容");}};reader.onerror=()=>toast("无法读取备份文件");reader.readAsText(file);}
function clearData(){if(!confirm("确定清空本机的游戏时间、成绩、次数和收藏吗？此操作不可撤销。"))return;stats={};firstStartedAt=0;try{localStorage.removeItem(storePrefix+"firstStartedAt");}catch(e){}favorites.clear();write("stats",stats);write("favorites",[]);renderHeatmap();renderRanking();renderHomeRecent();renderHomePoster();renderHomeMetrics();toast("本机记录已清空");}
$("mobileMenu").addEventListener("click",()=>shell.classList.toggle("menu-open"));
document.querySelectorAll("[data-view='home']").forEach(b=>b.addEventListener("click",showHome));
document.querySelectorAll(".nav-item[data-category]").forEach(b=>b.addEventListener("click",()=>showLibrary(b.dataset.category)));
$("breadcrumbCategory").addEventListener("click",()=>active?showLibrary(active.category):showHome());
$("gameSearch").addEventListener("input",e=>{search=e.target.value.trim().toLowerCase();renderLibrary();});
 $("startButton").addEventListener("click",()=>{if(started)endGame();else startGame();});$("pauseButton").addEventListener("click",togglePause);$("newGameButton").addEventListener("click",newRound);$("gamePauseResume").addEventListener("click",resumeGame);
 $("gameResultReplay").addEventListener("click",newRound);
 $("gameResultLeave").addEventListener("click",()=>{if(active)showLibrary(active.category);});
 document.querySelectorAll("[data-recent-tab]").forEach(b=>b.addEventListener("click",()=>{
  homeRecentTab=b.dataset.recentTab==="popular"?"popular":"recent";renderHomeRecent();
 }));
 $("homePosterPlay").addEventListener("click",e=>{e.stopPropagation();const id=$("homeGamePoster")?.dataset.game;if(id)openGame(id);});
 $("modeControl").addEventListener("click",e=>{const b=e.target.closest("button[data-mode-index]");if(b)setMode(b.dataset.modeIndex);});
 $("difficultyControl").addEventListener("click",e=>{const b=e.target.closest("button[data-difficulty]");if(b)setDifficulty(b.dataset.difficulty);});
 document.querySelectorAll("[data-home-category]").forEach(b=>b.addEventListener("click",()=>showLibrary(b.dataset.homeCategory)));
$("helpButton").addEventListener("click",()=>{openHelp();});$("helpClose").addEventListener("click",closeHelp);
let gameFullscreenRequested=false,nativeGameFullscreen=false;
function syncGameFullscreen(){
 const on=gameFullscreenRequested&&!!active&&!$("workspaceView").classList.contains("hidden");
 shell.classList.toggle("game-only-fullscreen",on);
 const exit=$("exitFullscreenButton");exit.hidden=!on;
 exit.setAttribute("aria-hidden",String(!on));
}
async function exitGameFullscreen(){
 gameFullscreenRequested=false;syncGameFullscreen();
 if(document.fullscreenElement){
  try{await document.exitFullscreen();}catch(e){/* CSS exit always works */ }
 }
}
$("fullscreenButton").addEventListener("click",async()=>{
 if(gameFullscreenRequested){await exitGameFullscreen();return;}
 if(active&&!$("workspaceView").classList.contains("hidden")){
  // The user's fullscreen action means an immersive, game-only layout.
  // Never depend on the browser's native Fullscreen API: it is disabled by
  // some file:// hosts and remote desktops, and can exit spontaneously.
  // The shell now fills the viewport while hiding both navigation regions.
  gameFullscreenRequested=true;syncGameFullscreen();
 }else{
  try{if(!document.fullscreenElement)await shell.requestFullscreen();else await document.exitFullscreen();}
  catch(e){toast("浏览器未允许全屏");}
 }
});
$("exitFullscreenButton").addEventListener("click",exitGameFullscreen);
document.addEventListener("fullscreenchange",()=>{
 if(document.fullscreenElement===shell){nativeGameFullscreen=gameFullscreenRequested;return;}
 if(nativeGameFullscreen){nativeGameFullscreen=false;gameFullscreenRequested=false;}
 syncGameFullscreen();
});
$("settingsButton").addEventListener("click",openSettings);$("settingsClose").addEventListener("click",closeSettings);$("settingsDone").addEventListener("click",closeSettings);
$("settingsBackdrop").addEventListener("click",e=>{if(e.target===$("settingsBackdrop"))closeSettings();});$("uiScale").addEventListener("change",e=>{settings.scale=e.target.value;write("settings",settings);applySettings();});
$("exportData").addEventListener("click",exportData);$("importData").addEventListener("click",()=>$("importFile").click());$("importFile").addEventListener("change",e=>{if(e.target.files?.[0])importData(e.target.files[0]);e.target.value="";});$("clearData").addEventListener("click",clearData);
document.querySelectorAll("[data-ranking]").forEach(b=>b.addEventListener("click",()=>{rankingType=b.dataset.ranking;document.querySelectorAll("[data-ranking]").forEach(x=>{const on=x===b;x.classList.toggle("active",on);x.setAttribute("aria-selected",String(on));});renderRanking();}));
document.addEventListener("click",e=>{if(shell.classList.contains("menu-open")&&!e.target.closest(".sidebar")&&!e.target.closest("#mobileMenu"))shell.classList.remove("menu-open");});
document.addEventListener("keydown",e=>{
 if(e.key==="Escape"){closeSettings();if(gameFullscreenRequested){e.preventDefault();exitGameFullscreen();}}
 const target=e.target instanceof Element?e.target:null;
 const editable=!!target&&(target.matches("input,textarea,select")||target.isContentEditable||!!target.closest("[contenteditable='true']"));
 if(e.key==="/"&&!editable){e.preventDefault();if(!libraryView.classList.contains("hidden"))$("gameSearch").focus();}
 if(!active||!ready||!started||session?.finished||e.repeat||editable||(e.key!=="Enter"&&e.key.toLowerCase()!=="p"))return;
 e.preventDefault();togglePause();
});

document.addEventListener("contextmenu",e=>{if(e.target instanceof Element&&e.target.closest("#workspaceView"))e.preventDefault();},true);
document.addEventListener("visibilitychange",()=>{if(document.hidden&&ready&&!paused)pauseGame();});
setInterval(()=>{if(session?.running)updateSessionDisplay();updateHomeClock();},1000);
setInterval(rotateHomePoster,6500);
window.addEventListener("beforeunload",()=>{if(session?.running)persistSessionTime();persistStats();});
if(typeof ResizeObserver!=="undefined"){
 heatmapObserver=new ResizeObserver(()=>resizeHeatmap());
 const heatmapGrid=$("heatmapGrid"),heatmapContent=heatmapGrid.parentElement,heatmapLayout=heatmapGrid.closest(".heatmap-layout"),activityPanel=heatmapGrid.closest(".activity-panel");
 [heatmapContent,heatmapLayout,activityPanel].forEach(node=>node&&heatmapObserver.observe(node));
}
 window.addEventListener("resize",()=>requestAnimationFrame(resizeHeatmap));
 updateCounts();applySettings();renderHeatmap();renderRanking();renderHomeRecent();renderHomePoster();updateHomeClock();
 requestAnimationFrame(resizeHeatmap);dragHelp();
})();