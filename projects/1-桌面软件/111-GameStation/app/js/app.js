(function(){
"use strict";
const games=[
{id:"gomoku",name:"五子棋",category:"board",categoryName:"棋类",icon:"⚫",description:"五子连线获胜。",status:"prototype",entry:"./games/gomoku/index.html",modes:["人机对战","本机双人"],difficulty:true,tip:"黑棋先行，率先在横、竖或斜线上连成五子的一方获胜。",help:[["基本规则","黑棋先行，双方轮流在棋盘交叉点落子。先形成连续五子的一方获胜。"],["操作","点击交叉点落子；悔棋按钮撤回上一步。人机模式由你执黑棋。"],["对战设置","顶部模式切换可选择人机或本机双人；难度分为简单、中等、困难。"],["AI 难度","简单：优先处理立即成五和必须防守，再从高分候选中随机选择；中等：攻防加权评分；困难：三层对抗式候选搜索，识别断点威胁并评估对手回应。"],["策略提示","优先争夺活三、冲四等连续威胁，同时留意对手的直接成五机会。"]]},
{id:"xiangqi",name:"中国象棋",category:"board",categoryName:"棋类",icon:"♟️",description:"楚河汉界，调度车马炮。",status:"prototype",entry:"./games/xiangqi/index.html",modes:["人机对战","本机双人"],difficulty:true,tip:"点击己方棋子，再点击合法目标位置。",help:[["基本规则","红黑双方轮流走子，目标是将死对方将帅。将帅不能照面。"],["棋子走法","将帅九宫一步；士斜走一步；象走田且不能塞象眼；马走日且不能蹩马腿；车直线；炮隔一子吃子；兵卒过河后可横走。"],["操作","点击己方棋子，再点击高亮的合法落点。可使用顶部模式和难度切换。"],["胜负","一方被将军且无合法应对时判负；无合法着法也判负。"]]},
{id:"reversi",name:"黑白棋",category:"board",categoryName:"棋类",icon:"⚪",description:"翻转棋子，占领更多格子。",status:"ready",entry:"./games/reversi/index.html",modes:["人机对战","本机双人"],difficulty:true,tip:"只能落在至少夹住一枚对方棋子的位置。",help:[["基本规则","双方轮流落子，夹住对方连续棋子后翻转。终局棋子较多的一方获胜。"],["操作","点击棋盘上可落子的格子。无合法步时自动跳过；双方均无合法步时结束。"],["对战设置","顶部可切换人机/双人及 AI 难度。"],["策略提示","角落非常重要；避免轻易占据会让对手获得角落的位置。"]]},
{id:"connect4",name:"四子棋",category:"board",categoryName:"棋类",icon:"🔴",description:"先将四枚棋子连成一线。",status:"ready",entry:"./games/connect4/index.html",modes:["人机对战","本机双人"],difficulty:true,tip:"选择列落子，棋子会落到最低空位。",help:[["基本规则","双方轮流把棋子投入七列棋盘，先在横、竖或斜线上连成四枚的一方获胜。"],["操作","点击任意列，棋子落入该列最低空位。"],["对战设置","顶部可切换人机/双人和 AI 难度。"],["策略提示","优先检查立即获胜点和对手的下一步连四威胁。"]]},
{id:"battleship",name:"海战棋",category:"board",categoryName:"棋类",icon:"🚢",description:"根据命中线索寻找隐藏舰队。",status:"ready",entry:"./games/battleship/index.html",difficulty:true,tip:"点击敌方海域攻击，击沉全部舰船即可获胜。",help:[["基本规则","敌我双方各有长度为 5、4、3、3、2 的舰船。先击沉对方全部舰船的一方获胜。"],["操作","点击敌方海域进行攻击。命中和未命中会分别标记。"],["AI 难度","简单随机搜索；中等采用命中追击；困难进一步利用舰船长度和剩余可能位置进行概率搜索。"],["策略提示","命中后优先检查相邻格，连续命中时沿直线追击。"]]},
{id:"chinese-checkers",name:"中国跳棋",category:"board",categoryName:"棋类",icon:"🔵",description:"121 孔六角星棋盘，十枚棋子连续跳跃到对面营地。",status:"playable",entry:"./games/chinese-checkers/index.html",modes:["人机对战","本机双人"],difficulty:true,tip:"点击自己的棋子，再点击绿色落点，支持连续跨子跳跃。",help:[["玩法","将十枚棋子全部移动至正对面三角营地即可获胜。"],["走法","六方向相邻走一步，或隔一颗棋子跳过至后方空点，可以连续跳跃且不吃子。"],["难度","简单随机合法移动，中等按目标前进评分，困难加入一回合对手回应评估。"],["操作","点击棋子后选择高亮落点，工具菜单支持悔棋。"]]},
{id:"flight-chess",name:"飞行棋",category:"board",categoryName:"棋类",icon:"✈️",description:"52 格航线、六点起飞、同色跳跃、撞机与终点竞速。",status:"playable",entry:"./games/flight-chess/index.html",modes:["人机对战","本机双人"],difficulty:true,tip:"点击中央骰子，掷六点起飞；再点击高亮飞机。",help:[["目标","红蓝双方各四架飞机，率先全部精确到达终点获胜。"],["规则","掷六点可起飞并获得额外回合；同色格可前进四格，特殊标记格可飞行；非安全格撞机返回机场。"],["操作","点击中央掷骰子，然后点击可移动的飞机；工具菜单可以悔棋。"],["难度","简单随机选择飞机、中等优先快速前进与撞机、困难评估对手下一次掷骰造成的风险。"]]},
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
const icons={play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg><span class="action-label">开始</span>',stop:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg><span class="action-label">结束</span>',pause:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg><span class="action-label">暂停</span>',resume:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg><span class="action-label">继续</span>',next:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14l11-7zM19 5v14"/></svg><span class="action-label">下一局</span>'};
const gameIconArt={
 "2048":"<rect x=\"5\" y=\"5\" width=\"17\" height=\"17\" rx=\"3\" fill=\"#e8c58e\" stroke=\"none\"/><rect x=\"26\" y=\"5\" width=\"17\" height=\"17\" rx=\"3\" fill=\"#d99b67\" stroke=\"none\"/><rect x=\"5\" y=\"26\" width=\"17\" height=\"17\" rx=\"3\" fill=\"#d98a64\" stroke=\"none\"/><rect x=\"26\" y=\"26\" width=\"17\" height=\"17\" rx=\"3\" fill=\"#b86e52\" stroke=\"none\"/><g fill=\"#fff\" stroke=\"none\" font-size=\"12\" font-weight=\"800\" text-anchor=\"middle\"><text x=\"13.5\" y=\"18\">2</text><text x=\"34.5\" y=\"18\">4</text><text x=\"13.5\" y=\"39\">8</text><text x=\"34.5\" y=\"39\">16</text></g>",
 "gomoku":"<path d=\"M9 9H39M9 24H39M9 39H39M9 9V39M24 9V39M39 9V39\" opacity=\".58\"/><circle cx=\"16.5\" cy=\"16.5\" r=\"4\" fill=\"currentColor\"/><circle cx=\"31.5\" cy=\"31.5\" r=\"4\" fill=\"#fff\"/><circle cx=\"31.5\" cy=\"31.5\" r=\"4\"/>",
 "xiangqi":"<circle cx=\"24\" cy=\"24\" r=\"18\"/><circle cx=\"24\" cy=\"24\" r=\"14\" opacity=\".45\"/><text x=\"24\" y=\"30\" text-anchor=\"middle\" font-family=\"Microsoft YaHei, sans-serif\" font-size=\"18\" font-weight=\"800\" fill=\"currentColor\" stroke=\"none\">将</text>",
 "reversi":"<circle cx=\"16\" cy=\"24\" r=\"10\" fill=\"#263d4e\" stroke=\"#263d4e\"/><circle cx=\"32\" cy=\"24\" r=\"10\" fill=\"#fff\"/><path d=\"M11 20a7 7 0 0 1 9-4\" stroke=\"#fff\" opacity=\".7\"/><path d=\"M27 20a7 7 0 0 1 9-4\" opacity=\".3\"/>",
 "connect4":"<rect x=\"7\" y=\"7\" width=\"34\" height=\"34\" rx=\"5\"/><circle cx=\"16\" cy=\"16\" r=\"4\" fill=\"#e46f61\" stroke=\"none\"/><circle cx=\"32\" cy=\"16\" r=\"4\" fill=\"#e8bd59\" stroke=\"none\"/><circle cx=\"16\" cy=\"31\" r=\"4\" fill=\"#e8bd59\" stroke=\"none\"/><circle cx=\"32\" cy=\"31\" r=\"4\" fill=\"#e46f61\" stroke=\"none\"/>",
 "battleship":"<path d=\"M6 29h36l-5 8H14z\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M14 28V20h8v8M24 28V15h8v13M29 15V11h5v4M8 40c4-2 7-2 11 0s7 2 11 0 7-2 10 0\"/>",
 "chinese-checkers":"<path d=\"M24 5 29 16 42 16 33 24 37 38 24 30 11 38 15 24 6 16 19 16Z\" opacity=\".55\"/><circle cx=\"24\" cy=\"13\" r=\"3.1\" fill=\"currentColor\"/><circle cx=\"14\" cy=\"22\" r=\"3.1\" fill=\"currentColor\"/><circle cx=\"34\" cy=\"22\" r=\"3.1\" fill=\"currentColor\"/><circle cx=\"18\" cy=\"33\" r=\"3.1\" fill=\"currentColor\"/><circle cx=\"30\" cy=\"33\" r=\"3.1\" fill=\"currentColor\"/>",
 "flight-chess":"<path d=\"M23 5c2-1 4 1 4 4v10l13 8v4l-13-4v9l5 4v3l-7-2-7 2v-3l5-4v-9L10 31v-4l13-8V9c0-2 0-3 0-4Z\" fill=\"currentColor\" stroke=\"none\"/>",
 "checkers":"<rect x=\"7\" y=\"7\" width=\"34\" height=\"34\" rx=\"3\"/><path d=\"M18 7v34M30 7v34M7 18h34M7 30h34\" opacity=\".45\"/><path d=\"M7 7h11v11H7zM30 18h11v12H30zM18 30h12v11H18z\" fill=\"currentColor\" stroke=\"none\" opacity=\".18\"/><circle cx=\"13\" cy=\"13\" r=\"4\" fill=\"currentColor\"/><circle cx=\"35\" cy=\"35\" r=\"4\" fill=\"#fff\"/>",
 "chess":"<path d=\"M12 39h26M16 35l2-7-4-7 5-10 8 3 7 8-3 7v6Z\"/><path d=\"m19 14 5 4-1-6M26 17l5 5M19 28h15\"/><circle cx=\"25\" cy=\"20\" r=\"1.5\" fill=\"currentColor\" stroke=\"none\"/>",
 "minesweeper":"<circle cx=\"24\" cy=\"24\" r=\"8\" fill=\"currentColor\"/><path d=\"M24 5v8M24 35v8M5 24h8M35 24h8M10.5 10.5l5.7 5.7M31.8 31.8l5.7 5.7M37.5 10.5l-5.7 5.7M16.2 31.8l-5.7 5.7\"/><circle cx=\"21\" cy=\"21\" r=\"2\" fill=\"#fff\" stroke=\"none\"/>",
 "memory":"<rect x=\"8\" y=\"10\" width=\"23\" height=\"29\" rx=\"4\" transform=\"rotate(-9 8 10)\"/><rect x=\"19\" y=\"8\" width=\"22\" height=\"30\" rx=\"4\" fill=\"#fff\"/><path d=\"m30 15 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7Z\" fill=\"currentColor\" stroke=\"none\"/>",
 "sudoku":"<rect x=\"7\" y=\"7\" width=\"34\" height=\"34\" rx=\"2\"/><path d=\"M18.3 7v34M29.7 7v34M7 18.3h34M7 29.7h34\" opacity=\".7\"/><g fill=\"currentColor\" stroke=\"none\" font-size=\"9\" font-weight=\"750\" text-anchor=\"middle\"><text x=\"12.5\" y=\"16\">1</text><text x=\"24\" y=\"27\">5</text><text x=\"35.5\" y=\"38\">9</text></g>",
 "sokoban":"<rect x=\"9\" y=\"9\" width=\"30\" height=\"30\" rx=\"4\"/><path d=\"M15 15h18v18H15z\" stroke-dasharray=\"2.5 2.5\" opacity=\".6\"/><path d=\"m18 24 6-6 6 6M24 18v13\" stroke-width=\"2.8\"/><circle cx=\"34\" cy=\"14\" r=\"3\" fill=\"currentColor\" stroke=\"none\"/>",
 "tetris":"<path d=\"M8 8h10v10H8zM18 8h10v10H18zM28 8h10v10H28zM18 18h10v10H18zM18 28h10v10H18z\" fill=\"currentColor\"/><path d=\"M8 8h10v10H8zM18 8h10v10H18zM28 8h10v10H28zM18 18h10v10H18zM18 28h10v10H18z\" opacity=\".25\"/>",
 "snake":"<path d=\"M10 14h11a5 5 0 0 1 0 10h-1a5 5 0 0 0 0 10h12a6 6 0 0 0 0-12h-1\" stroke-width=\"5\"/><circle cx=\"12\" cy=\"14\" r=\"4\" fill=\"currentColor\"/><circle cx=\"13.5\" cy=\"13\" r=\"1.1\" fill=\"#fff\" stroke=\"none\"/><circle cx=\"36\" cy=\"10\" r=\"3\" fill=\"#d9a45f\" stroke=\"none\"/>",
 "pong":"<rect x=\"7\" y=\"12\" width=\"5\" height=\"24\" rx=\"2\" fill=\"currentColor\" stroke=\"none\"/><rect x=\"36\" y=\"16\" width=\"5\" height=\"20\" rx=\"2\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"25\" cy=\"18\" r=\"4\" fill=\"#dba85f\" stroke=\"none\"/><path d=\"M24 27v3m0 4v3m0-22v3\" stroke-dasharray=\"1 2\" opacity=\".5\"/>",
 "contra":"<path d=\"M7 19h18l4-4h8v4h5v7h-5v4h-8l-4-4H7z\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M16 19v-5h7v5M17 30l-4 7M23 30l-2 7\"/><circle cx=\"38\" cy=\"22.5\" r=\"1.5\" fill=\"#fff\" stroke=\"none\"/>",
 "mario":"<path d=\"M9 25c0-9 6-16 15-16s15 7 15 16H9Z\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M15 25v10a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4V25Z\" fill=\"#fff\"/><circle cx=\"18\" cy=\"19\" r=\"2.5\" fill=\"#fff\" stroke=\"none\"/><circle cx=\"29\" cy=\"15\" r=\"2.5\" fill=\"#fff\" stroke=\"none\"/><path d=\"M18 25v6m12-6v6\"/>",
 "tank":"<path d=\"M7 28h34v8H7z\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M9 37h30\" stroke-width=\"3\"/><circle cx=\"14\" cy=\"37\" r=\"2\" fill=\"#fff\" stroke=\"none\"/><circle cx=\"24\" cy=\"37\" r=\"2\" fill=\"#fff\" stroke=\"none\"/><circle cx=\"34\" cy=\"37\" r=\"2\" fill=\"#fff\" stroke=\"none\"/><rect x=\"13\" y=\"18\" width=\"22\" height=\"11\" rx=\"3\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M21 18v-6h10v6M29 14h11v4H29\" stroke-width=\"3\"/><circle cx=\"24\" cy=\"23.5\" r=\"2.5\" fill=\"#fff\" stroke=\"none\"/>",
 "solitaire":"<rect x=\"9\" y=\"5\" width=\"30\" height=\"38\" rx=\"4\" fill=\"#fff\"/><path d=\"M24 15c-2-5-9-4-9 2 0 5 9 12 9 12s9-7 9-12c0-6-7-7-9-2Z\" fill=\"#c85c58\" stroke=\"none\"/><path d=\"M13 11h5M13 16h3\" stroke=\"#c85c58\" stroke-width=\"1.5\"/>",
 "doudizhu":"<rect x=\"7\" y=\"12\" width=\"23\" height=\"31\" rx=\"3\" transform=\"rotate(-13 7 12)\" fill=\"#fff\"/><rect x=\"18\" y=\"6\" width=\"23\" height=\"31\" rx=\"3\" transform=\"rotate(10 18 6)\" fill=\"#fff\"/><path d=\"M29 14c-2-4-7-3-7 1 0 4 7 9 7 9s7-5 7-9c0-4-5-5-7-1Z\" fill=\"#d65c58\" stroke=\"none\"/>",
 "mahjong":"<rect x=\"9\" y=\"5\" width=\"30\" height=\"38\" rx=\"4\" fill=\"#fff\"/><path d=\"M16 13l4 8m-1-9 4 8m-1-9 4 8M16 25l4 8m-1-9 4 8m-1-9 4 8\" stroke=\"#4e9875\" stroke-width=\"2.8\"/><circle cx=\"33\" cy=\"15\" r=\"2.2\" fill=\"#c75b58\" stroke=\"none\"/><circle cx=\"33\" cy=\"24\" r=\"2.2\" fill=\"#c75b58\" stroke=\"none\"/>",
 "sanguosha":"<path d=\"m11 9 7 7m-7-7 1 9m-1-9 9 1M37 9l-7 7m7-7-1 9m1-9-9 1M18 16l12 16m-12 0 12-16\" stroke-width=\"2.8\"/><path d=\"M14 35 34 15M14 15l20 20\" stroke-width=\"3\"/>",
 "default":"<rect x=\"6\" y=\"13\" width=\"36\" height=\"22\" rx=\"7\"/><path d=\"M16 19v10m-5-5h10M31 21h.1M36 27h.1\"/><circle cx=\"31\" cy=\"21\" r=\"1.8\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"36\" cy=\"27\" r=\"1.8\" fill=\"currentColor\" stroke=\"none\"/>"
};
function gameIconMarkup(game){
 const art=gameIconArt[game.id]||gameIconArt.default;
 return '<svg class="game-icon-svg" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'+art+'</svg>';
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
function showGameNotice(message,timeout=2400,persistent=false){
 const box=$("gameNotice");if(!box)return;const value=String(message||"").trim();if(!value)return;
 if(persistent)permanentGameStatus=value;
 clearTimeout(centerNoticeTimer);box.textContent=value;box.classList.add("visible");
 if(timeout>0)centerNoticeTimer=setTimeout(()=>{box.textContent=permanentGameStatus;box.classList.toggle("visible",!!permanentGameStatus);},timeout);
}
function clearGameNotice(){clearTimeout(centerNoticeTimer);permanentGameStatus="";const box=$("gameNotice");if(box){box.textContent="";box.classList.remove("visible");}}
function toast(message){const el=$("toast");if(active){el.classList.remove("show");showGameNotice(message);return;}el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),1900);}
let stats=normalizeStats(read("stats",{})),settings=normalizeSettings(read("settings",{scale:"1"})),favorites=new Set(normalizeFavorites(read("favorites",[]))),firstStartedAt=Math.max(0,Number(read("firstStartedAt",0))||0);
let active=null,sessionId=null,ready=false,paused=true,started=false,roundCounted=false,modeIndex=0,difficulty="normal",currentScore=0,session=null,currentCategory="all",search="",rankingType="score",lastHomeDay="",railCollapsed=false,heatmapObserver=null,helpSource={lines:[],note:""};
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
 $("activitySummary").textContent="近 12 个月 · "+activeDays+" 天有记录 · "+fmtDuration(total);
 resizeHeatmap();
}
function resizeHeatmap(){
 const grid=$("heatmapGrid"),content=grid?.parentElement,layout=grid?.closest(".heatmap-layout");
 if(!grid||!content||!layout)return;
 const weeks=Number(grid.dataset.weeks)||53,available=Math.max(0,content.clientWidth),gap=available<760?2:3;
 const cell=Math.max(7,Math.min(22,Math.floor(((available-(weeks-1)*gap)/weeks)*2)/2));
 layout.style.setProperty("--heat-cell",cell+"px");layout.style.setProperty("--heat-gap",gap+"px");
 grid.style.setProperty("--heat-cell",cell+"px");grid.style.setProperty("--heat-gap",gap+"px");
 const gridWidth=grid.getBoundingClientRect().width;
 const months=$("heatmapMonths"),legend=content.querySelector(".heatmap-legend");
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
  button.innerHTML='<span class="ranking-rank">'+String(i+1).padStart(2,"0")+'</span><span class="ranking-name" title="'+escapeHtml(x.game.name)+'">'+escapeHtml(x.game.name)+'</span><span class="ranking-value">'+value+'</span>';
  button.addEventListener("click",()=>openGame(x.game.id));li.appendChild(button);list.appendChild(li);
 });
}
function renderHomeRecent(){
 const list=$("homeRecentList");if(!list)return;
 const played=games.map(game=>({game,stat:stats[game.id]||{plays:0,totalMs:0,lastPlayed:"",lastPlayedAt:0}}))
  .filter(row=>row.stat.plays>0||row.stat.lastPlayed)
  .sort((a,b)=>statPlayedAt(b.stat)-statPlayedAt(a.stat)||b.stat.plays-a.stat.plays);
 const rows=played.slice(0,8);
 $("recentSubtitle").textContent=played.length?"按最近游玩时间排序 · 最近 "+Math.min(played.length,8)+" 款":"暂无记录";
 list.innerHTML="";
 if(!rows.length){
  const empty=document.createElement("div");empty.className="recent-empty";
  empty.textContent="还没有游玩记录，开始一局后会按时间顺序显示在这里";
  list.appendChild(empty);return;
 }
 rows.forEach(({game})=>{
  const button=document.createElement("button");button.type="button";button.className="recent-game";
  button.title="再次开始 "+game.name;button.setAttribute("aria-label","再次开始 "+game.name);button.dataset.game=game.id;
  button.innerHTML='<span class="recent-icon" data-category="'+game.category+'" data-game="'+game.id+'" aria-hidden="true">'+gameIconMarkup(game)+'</span><span class="recent-copy"><strong>'+escapeHtml(game.name)+'</strong></span>';
  button.addEventListener("click",()=>openGame(game.id));list.appendChild(button);
 });
}
function updateCounts(){for(const cat of Object.keys(categoryNames))$("count-"+cat).textContent=games.filter(g=>cat==="all"||g.category===cat).length;if($("totalGameCount"))$("totalGameCount").textContent=String(games.length);["board","puzzle","arcade","card"].forEach(cat=>{const el=$("homeCount-"+cat);if(el)el.textContent=games.filter(g=>g.category===cat).length+" 款";});}
function showHome(){closeGame();homeView.classList.remove("hidden");libraryView.classList.add("hidden");workspaceView.classList.add("hidden");$("breadcrumbCategory").textContent="首页";$("crumbGameSep").classList.add("hidden");$("breadcrumbGame").classList.add("hidden");$("gameControls").classList.add("hidden");$("gameActions").classList.add("hidden");$("railToggleButton").classList.add("hidden");$("helpButton").classList.add("hidden");document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view==="home"));shell.classList.remove("menu-open");updateHomeClock();renderHeatmap();renderRanking();renderHomeRecent();renderHomeMetrics();}
function showLibrary(category){closeGame();currentCategory=category||"all";homeView.classList.add("hidden");libraryView.classList.remove("hidden");workspaceView.classList.add("hidden");$("breadcrumbCategory").textContent=categoryNames[currentCategory]||"全部游戏";$("crumbGameSep").classList.add("hidden");$("breadcrumbGame").classList.add("hidden");$("gameControls").classList.add("hidden");$("gameActions").classList.add("hidden");$("railToggleButton").classList.add("hidden");$("libraryTitle").textContent=categoryNames[currentCategory]||"全部游戏";document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.category===currentCategory));renderLibrary();shell.classList.remove("menu-open");}
function renderLibrary(){const grid=$("gameGrid");grid.innerHTML="";const rows=games.filter(g=>(currentCategory==="all"||g.category===currentCategory)&&(!search||(g.name+" "+g.description).toLowerCase().includes(search)));$("libraryCount").textContent=rows.length+" 款";$("emptyState").classList.toggle("hidden",rows.length>0);rows.forEach(g=>{const b=document.createElement("button");b.className="game-card";b.type="button";b.innerHTML='<span class="game-card-icon" data-category="'+g.category+'" data-game="'+g.id+'" aria-hidden="true">'+gameIconMarkup(g)+'</span><span class="game-card-copy"><strong class="game-card-title">'+escapeHtml(g.name)+'</strong><span class="game-card-meta"><i class="game-card-status '+(g.status==="prototype"?"prototype":"")+'"></i>'+(g.status==="prototype"?"持续完善":"可直接游玩")+'</span></span><span class="game-card-arrow">›</span>';b.addEventListener("click",()=>openGame(g.id));grid.appendChild(b);});}
function send(type,payload={}){if(!active||!frame.contentWindow)return;frame.contentWindow.postMessage({channel:"gamestation",protocolVersion:1,gameId:active.id,sessionId,type,payload},"*");}
function setBreadcrumb(){$("breadcrumbCategory").textContent=active.categoryName;$("crumbGameSep").classList.remove("hidden");$("breadcrumbGame").textContent=active.name;$("breadcrumbGame").classList.remove("hidden");}
function renderGameControls(){
 const modeEl=$("modeControl"),difficultyEl=$("difficultyControl"),hasModes=Array.isArray(active?.modes)&&active.modes.length>1;
 modeEl.classList.toggle("hidden",!hasModes);modeEl.innerHTML="";
 if(hasModes)active.modes.forEach((label,index)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.dataset.modeIndex=String(index);b.setAttribute("aria-pressed",String(index===modeIndex));modeEl.appendChild(b);});
 const hasDifficulty=!!active?.difficulty;difficultyEl.classList.toggle("hidden",!hasDifficulty);difficultyEl.innerHTML="";
 if(hasDifficulty){const labels=active.difficultyLabels||["简单","中等","困难"],values=["easy","normal","hard"];labels.forEach((label,index)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.dataset.difficulty=values[index]||"hard";b.setAttribute("aria-pressed",String((values[index]||"hard")===difficulty));difficultyEl.appendChild(b);});}
 $("gameControls").classList.toggle("hidden",!hasModes&&!hasDifficulty);
}
function setGameState(){
 $("gameElapsed").textContent=session?fmtClock(session.elapsedMs):"00:00";
 const finished=!!session?.finished,startLabel=started?"结束":"开始",pauseLabel=started&&!finished&&paused?"继续":"暂停";
 $("startButton").innerHTML=started?icons.stop:icons.play;$("startButton").setAttribute("aria-label",startLabel);$("startButton").title=startLabel;
 $("startButton").classList.toggle("end-action",started);$("startButton").disabled=!ready||finished||(!started&&!paused);
 $("pauseButton").innerHTML=started&&!finished&&paused?icons.resume:icons.pause;$("pauseButton").setAttribute("aria-label",pauseLabel);$("pauseButton").title=pauseLabel;$("pauseButton").classList.toggle("continue-action",started&&!finished&&paused);
 $("pauseButton").disabled=!ready||!started||finished;
 $("newGameButton").innerHTML=icons.next;$("newGameButton").setAttribute("aria-label","下一局");$("newGameButton").title="下一局";$("newGameButton").disabled=!ready;
 if(active&&ready)send("HUD_STATE",{ready,started,paused,finished,elapsed:session?fmtClock(session.elapsedMs):"00:00",modeIndex,difficulty});
}
function persistSessionTime(){if(!session||!session.running)return;const now=Date.now(),delta=Math.max(0,now-session.lastTick);session.lastTick=now;session.elapsedMs+=delta;const s=statFor(session.id),key=dateKey(new Date(now));s.totalMs+=delta;s.days[key]=(Number(s.days[key])||0)+delta;}
function startClock(){if(!session||session.running)return;session.running=true;session.lastTick=Date.now();started=true;paused=false;setGameState();}
function stopClock(){if(session&&session.running){persistSessionTime();session.running=false;persistStats();renderHeatmap();renderRanking();}paused=true;setGameState();}
function updateSessionDisplay(){if(session&&session.running){persistSessionTime();$("gameElapsed").textContent=fmtClock(session.elapsedMs);if(active&&ready)send("HUD_STATE",{ready,started,paused,finished:!!session?.finished,elapsed:fmtClock(session.elapsedMs),modeIndex,difficulty});if(Date.now()-session.lastSave>5000){session.lastSave=Date.now();persistStats();}}}
function countRound(){if(!session||roundCounted)return;const now=Date.now(),s=statFor(session.id);if(!firstStartedAt){firstStartedAt=inferFirstStartedAt()||now;write("firstStartedAt",firstStartedAt);}s.plays++;s.lastPlayed=dateKey(new Date(now));s.lastPlayedAt=now;roundCounted=true;persistStats();renderRanking();renderHomeRecent();renderHomeMetrics();}
function startGame(){if(!ready||!paused||started||session?.finished)return;if(session?.needsInit){send("NEW_GAME");session.needsInit=false;}if(!roundCounted)countRound();send("RESUME");startClock();focusGameFrame();toast("开始游戏");}
function endGame(){if(!ready||!started||session?.finished)return;if(!paused)send("PAUSE");stopClock();session.finished=true;persistStats();setGameState();showGameNotice("本局已结束",0,true);}
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
 stopClock();session.elapsedMs=0;session.finished=false;session.score=0;session.lastSave=Date.now();session.needsInit=false;
 currentScore=0;started=false;roundCounted=false;paused=true;
 send("NEW_GAME");send("RESUME");if(!roundCounted)countRound();startClock();focusGameFrame();setGameState();renderGameControls();
}
function finishGame(payload={}){if(!session||session.finished)return;stopClock();session.finished=true;const s=statFor(session.id);if(Number.isFinite(Number(payload.score)))s.bestScore=Math.max(s.bestScore,Number(payload.score));const msg=String(payload.message||"");if(payload.win===true||/获胜|胜利|通关|完成|挑战成功|你赢/.test(msg))s.wins++;persistStats();renderHeatmap();renderRanking();renderHomeRecent();renderHomeMetrics();setGameState();}
function openGame(id){
 const g=games.find(x=>x.id===id);if(!g)return;closeGame();active=g;
 sessionId=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():"gs-"+Date.now()+"-"+Math.random().toString(16).slice(2);
 ready=false;paused=true;started=false;roundCounted=false;modeIndex=0;difficulty="normal";currentScore=0;railCollapsed=false;helpSource={lines:[],note:""};
 session={id:g.id,elapsedMs:0,lastTick:0,lastSave:Date.now(),running:false,finished:false,score:0,needsInit:true};
 setBreadcrumb();$("gameActions").classList.remove("hidden");$("railToggleButton").classList.remove("hidden");$("helpButton").classList.remove("hidden");
 $("railToggleButton").setAttribute("aria-expanded","true");$("railToggleButton").title="收起右侧操作栏";$("railToggleButton").setAttribute("aria-label","收起右侧操作栏");
 renderGameControls();$("startButton").disabled=true;$("newGameButton").disabled=true;$("pauseButton").disabled=true;
 $("gameElapsed").textContent="00:00";$("hostGameTimer").classList.remove("hidden");clearGameNotice();$("helpTitle").textContent=g.name+" · 玩法";
 homeView.classList.add("hidden");libraryView.classList.add("hidden");workspaceView.classList.remove("hidden");
 $("stageLoading").classList.remove("done");frame.title=g.name+" 游戏";frame.src=g.entry;closeHelp();shell.classList.remove("menu-open");
}
function closeGame(){if(active){if(ready){if(!paused)send("PAUSE");send("DISPOSE");}if(session?.running)stopClock();if(session)persistStats();frame.src="about:blank";}active=null;session=null;ready=false;paused=true;started=false;$("hostGameTimer").classList.add("hidden");$("gameControls").classList.add("hidden");$("gameActions").classList.add("hidden");$("railToggleButton").classList.add("hidden");$("helpButton").classList.add("hidden");clearGameNotice();}
window.addEventListener("message",event=>{
 if(!active||event.source!==frame.contentWindow)return;
 const m=event.data;
 if(!m||m.channel!=="gamestation"||m.protocolVersion!==1||m.gameId!==active.id)return;
 if(m.type==="READY"&&!ready){
  ready=true;
  send("INIT",{sessionId,mode:active.modes?.[modeIndex]==="本机双人"?"two":"ai",difficulty,name:active.name,modes:active.modes||[],hasDifficulty:!!active.difficulty,difficultyLabels:active.difficultyLabels||["简单","中等","困难"]});
  send("PAUSE");
  paused=true;
  setGameState();
  $("stageLoading").classList.add("done");
  send("SET_RAIL",{collapsed:railCollapsed});
  return;
 }
 if(m.sessionId!==sessionId)return;
 if(m.type==="HOTKEY"){if(["toggle","pause","start"].includes(m.payload?.action))toggleGamePause();return;}
 if(m.type==="ACTIVITY"){if(!started)startGame();else if(paused)resumeGame();return;}
 
if(m.type==="CONTROL"){const action=m.payload?.action;if(action==="start"){if(started)endGame();else startGame();}else if(action==="toggle")toggleGamePause();else if(action==="new")newRound();else if(action==="mode")setMode(m.payload?.index);else if(action==="difficulty")setDifficulty(m.payload?.value);else if(action==="help")openHelp();return;}
 if(m.type==="TOOLS_STATE"){
  const expanded=!!m.payload?.expanded;
  railCollapsed=!expanded;
  $("railToggleButton").setAttribute("aria-expanded",String(expanded));
  $("railToggleButton").title=expanded?"收起右侧工具栏":"展开右侧工具栏";
  $("railToggleButton").setAttribute("aria-label",$("railToggleButton").title);
  return;
 }
 if(m.type==="TOOLS_META"){
   const hasActions=!!m.payload?.hasActions;
   railCollapsed=!hasActions;
   $("railToggleButton").classList.toggle("hidden",!hasActions);
   $("railToggleButton").setAttribute("aria-expanded",String(hasActions));
   send("SET_RAIL",{collapsed:!hasActions});
   return;
  }
  if(m.type==="HELP_SOURCE"){helpSource={lines:m.payload?.lines||[],note:m.payload?.note||""};if(!$("helpPanel").classList.contains("hidden"))renderHelp();return;}
 if(m.type==="REQUEST_NEW_GAME"){newRound();return;}
 if(m.type==="STATE"){
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
  showGameNotice(m.payload?.message||"游戏结束",0,true);
 }else if(m.type==="ERROR"){
  showGameNotice(m.payload?.message||"游戏模块发生错误",0,true);
 }
});
function setMode(index){if(!active?.modes||active.modes.length<2)return;const next=Math.max(0,Math.min(active.modes.length-1,Number(index)));if(next===modeIndex)return;modeIndex=next;renderGameControls();send("SET_MODE",{mode:active.modes[modeIndex]==="本机双人"?"two":"ai"});newRound();}
function setDifficulty(value){if(!active?.difficulty||!["easy","normal","hard"].includes(value)||value===difficulty)return;difficulty=value;renderGameControls();send("SET_DIFFICULTY",{difficulty});newRound();}
function renderHelp(){const content=$("helpContent");content.innerHTML="";const chapters=active?[...active.help,...(helpSource.lines.length?[["快捷键与鼠标",helpSource.lines.join("；")]]:[]),...(helpSource.note?[["游戏操作提醒",helpSource.note]]:[]),["统一操作","Enter 暂停/继续；游戏区域右键由游戏接管。"]]:[["离线运行","所有游戏均在本机浏览器中运行，不需要账号、服务器或网络连接。"],["游戏导航","左侧按棋类、益智、街机和卡牌分类浏览游戏。"],["成绩与记录","首页热力图和排行榜只读取当前浏览器中的本地游戏记录。"],["数据备份","在左下角全局设置中导出或导入 JSON 备份。"]];chapters.forEach((item,i)=>{const section=document.createElement("section");section.className="help-chapter";const button=document.createElement("button");button.type="button";button.innerHTML='<span>'+escapeHtml(item[0])+'</span><span>'+(i===0?"−":"＋")+'</span>';const p=document.createElement("p");p.textContent=item[1];p.hidden=i!==0;button.addEventListener("click",()=>{p.hidden=!p.hidden;button.querySelector("span:last-child").textContent=p.hidden?"＋":"−";});section.append(button,p);content.appendChild(section);});}
function openHelp(){renderHelp();$("helpPanel").classList.remove("hidden");}
function closeHelp(){$("helpPanel").classList.add("hidden");}
function dragHelp(){const panel=$("helpPanel"),header=$("helpHeader");let dragging=false,startX=0,startY=0,left=0,top=0;header.addEventListener("pointerdown",e=>{if(e.target.closest("button"))return;dragging=true;const r=panel.getBoundingClientRect();left=r.left;top=r.top;startX=e.clientX;startY=e.clientY;panel.style.left=left+"px";panel.style.top=top+"px";panel.style.right="auto";header.setPointerCapture(e.pointerId);});header.addEventListener("pointermove",e=>{if(!dragging)return;const x=Math.max(8,Math.min(window.innerWidth-panel.offsetWidth-8,left+e.clientX-startX));const y=Math.max(8,Math.min(window.innerHeight-48,top+e.clientY-startY));panel.style.left=x+"px";panel.style.top=y+"px";});header.addEventListener("pointerup",()=>dragging=false);header.addEventListener("pointercancel",()=>dragging=false);}
function openSettings(){$("settingsBackdrop").classList.remove("hidden");applySettings();}
function closeSettings(){$("settingsBackdrop").classList.add("hidden");}
function exportData(){const payload={app:"GameStation",schemaVersion:2,appVersion:"1.1",exportedAt:new Date().toISOString(),firstStartedAt:firstStartedAt||inferFirstStartedAt(),stats:normalizeStats(stats),favorites:normalizeFavorites([...favorites]),settings:normalizeSettings(settings)};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="gamestation-backup-"+dateKey(new Date())+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast("本地 JSON 备份已生成");}
function importData(file){const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(String(reader.result));if(!data||data.app!=="GameStation"||![1,2].includes(Number(data.schemaVersion))||!data.stats||typeof data.stats!=="object"||Array.isArray(data.stats))throw new Error("格式不正确");if(!confirm("导入备份将替换本机现有的游戏记录、收藏和界面设置。建议先导出当前数据。继续吗？"))return;const nextStats=normalizeStats(data.stats),nextFavorites=normalizeFavorites(data.favorites),nextSettings=normalizeSettings(data.settings);if(!write("stats",nextStats)||!write("favorites",nextFavorites)||!write("settings",nextSettings))throw new Error("本地存储写入失败");stats=nextStats;firstStartedAt=Math.max(0,Number(data.firstStartedAt)||0)||inferFirstStartedAt();if(firstStartedAt)write("firstStartedAt",firstStartedAt);else try{localStorage.removeItem(storePrefix+"firstStartedAt");}catch(e){}favorites=new Set(nextFavorites);settings=nextSettings;applySettings();renderHeatmap();renderRanking();renderHomeRecent();renderHomeMetrics();toast("备份已恢复到当前浏览器");}catch(e){toast("备份文件无效、损坏或版本不兼容");}};reader.onerror=()=>toast("无法读取备份文件");reader.readAsText(file);}
function clearData(){if(!confirm("确定清空本机的游戏时间、成绩、次数和收藏吗？此操作不可撤销。"))return;stats={};firstStartedAt=0;try{localStorage.removeItem(storePrefix+"firstStartedAt");}catch(e){}favorites.clear();write("stats",stats);write("favorites",[]);renderHeatmap();renderRanking();renderHomeRecent();renderHomeMetrics();toast("本机记录已清空");}
$("mobileMenu").addEventListener("click",()=>shell.classList.toggle("menu-open"));
document.querySelectorAll("[data-view='home']").forEach(b=>b.addEventListener("click",showHome));
document.querySelectorAll("[data-category]").forEach(b=>b.addEventListener("click",()=>showLibrary(b.dataset.category)));
$("breadcrumbCategory").addEventListener("click",()=>active?showLibrary(active.category):showHome());
$("gameSearch").addEventListener("input",e=>{search=e.target.value.trim().toLowerCase();renderLibrary();});
 $("startButton").addEventListener("click",()=>{if(started)endGame();else startGame();});$("pauseButton").addEventListener("click",togglePause);$("newGameButton").addEventListener("click",newRound);
 $("railToggleButton").addEventListener("click",()=>{
  railCollapsed=!railCollapsed;send("SET_RAIL",{collapsed:railCollapsed});
  $("railToggleButton").setAttribute("aria-expanded",String(!railCollapsed));
  $("railToggleButton").title=railCollapsed?"展开右侧操作栏":"收起右侧操作栏";
  $("railToggleButton").setAttribute("aria-label",$("railToggleButton").title);
  $("railToggleButton").innerHTML=railCollapsed?'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M9 10l3 2-3 2"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M9 10l-3 2 3 2"/></svg>';
 });
 $("modeControl").addEventListener("click",e=>{const b=e.target.closest("button[data-mode-index]");if(b)setMode(b.dataset.modeIndex);});
 $("difficultyControl").addEventListener("click",e=>{const b=e.target.closest("button[data-difficulty]");if(b)setDifficulty(b.dataset.difficulty);});
 document.querySelectorAll("[data-home-category]").forEach(b=>b.addEventListener("click",()=>showLibrary(b.dataset.homeCategory)));
$("helpButton").addEventListener("click",()=>{openHelp();});$("helpClose").addEventListener("click",closeHelp);
$("fullscreenButton").addEventListener("click",async()=>{try{if(!document.fullscreenElement)await shell.requestFullscreen();else await document.exitFullscreen();}catch(e){toast("浏览器未允许全屏");}});
$("settingsButton").addEventListener("click",openSettings);$("settingsClose").addEventListener("click",closeSettings);$("settingsDone").addEventListener("click",closeSettings);
$("settingsBackdrop").addEventListener("click",e=>{if(e.target===$("settingsBackdrop"))closeSettings();});$("uiScale").addEventListener("change",e=>{settings.scale=e.target.value;write("settings",settings);applySettings();});
$("exportData").addEventListener("click",exportData);$("importData").addEventListener("click",()=>$("importFile").click());$("importFile").addEventListener("change",e=>{if(e.target.files?.[0])importData(e.target.files[0]);e.target.value="";});$("clearData").addEventListener("click",clearData);
document.querySelectorAll("[data-ranking]").forEach(b=>b.addEventListener("click",()=>{rankingType=b.dataset.ranking;document.querySelectorAll("[data-ranking]").forEach(x=>{const on=x===b;x.classList.toggle("active",on);x.setAttribute("aria-selected",String(on));});renderRanking();}));
document.addEventListener("click",e=>{if(shell.classList.contains("menu-open")&&!e.target.closest(".sidebar")&&!e.target.closest("#mobileMenu"))shell.classList.remove("menu-open");});
document.addEventListener("keydown",e=>{
 if(e.key==="Escape"){closeSettings();}
 const target=e.target instanceof Element?e.target:null;
 const editable=!!target&&(target.matches("input,textarea,select")||target.isContentEditable||!!target.closest("[contenteditable='true']"));
 if(e.key==="/"&&!editable){e.preventDefault();if(!libraryView.classList.contains("hidden"))$("gameSearch").focus();}
 if(!active||!ready||e.repeat||editable||(e.key!=="Enter"&&e.key.toLowerCase()!=="p"))return;
 e.preventDefault();toggleGamePause();
});

document.addEventListener("contextmenu",e=>{if(e.target instanceof Element&&e.target.closest("#workspaceView"))e.preventDefault();},true);
document.addEventListener("visibilitychange",()=>{if(document.hidden&&ready&&!paused)pauseGame();});
setInterval(()=>{if(session?.running)updateSessionDisplay();updateHomeClock();},1000);
window.addEventListener("beforeunload",()=>{if(session?.running)persistSessionTime();persistStats();});
if(typeof ResizeObserver!=="undefined"){heatmapObserver=new ResizeObserver(resizeHeatmap);heatmapObserver.observe($("heatmapGrid").parentElement);}
 window.addEventListener("resize",resizeHeatmap);
 updateCounts();applySettings();renderHeatmap();renderRanking();renderHomeRecent();updateHomeClock();dragHelp();
})();