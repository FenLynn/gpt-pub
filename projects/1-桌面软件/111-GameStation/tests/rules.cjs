/* P111 R17 - deterministic rules fixtures. All files are opened via file:// */
const assert=require("node:assert/strict");
const path=require("node:path"),{pathToFileURL}=require("node:url");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:["--no-sandbox","--disable-dev-shm-usage","--allow-file-access-from-files"]});
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 const errors=[];page.on("pageerror",err=>errors.push(err.message));
 try{
  const src=pathToFileURL(path.resolve(__dirname,"../app/games/chess/index.html")).href+"?p111Test=1";
  await page.goto(src);
  await page.waitForFunction(()=>typeof window.__p111ChessTest?.loadFen==="function");
  const fen=async f=>page.evaluate(value=>window.__p111ChessTest.loadFen(value),f);
  const profiles=await page.evaluate(()=>["easy","normal","hard"].map(level=>window.__p111ChessTest.aiProfile(level)));
  assert.deepEqual(profiles.map(x=>x.depth),[0,2,3],"International chess must offer three genuinely different search depths");
  assert.ok(profiles[2].width>profiles[1].width,"Hard AI must search more reply candidates");
  const move=async(from,to)=>{
   await page.locator('[data-square="'+from+'"]').click();
   await page.locator('[data-square="'+to+'"]').click();
  };
  const piece=async sq=>page.locator('[data-square="'+sq+'"] .chess-piece').innerText().catch(()=>"");
  const st=()=>page.evaluate(()=>window.__p111ChessTest.state());
  // Both castle directions reposition king AND rook, without creating a new piece.
  await fen("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  await move("e1","g1");
  assert.equal(await piece("g1"),"♔");assert.equal(await piece("f1"),"♖");
  assert.equal(await piece("e1"),"");assert.equal(await piece("h1"),"");
  await fen("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  await move("e1","c1");
  assert.equal(await piece("c1"),"♔");assert.equal(await piece("d1"),"♖");
  assert.equal(await piece("a1"),"");
  // Illegal castle through an attacked transit square.
  await fen("4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  await move("e1","g1");
  assert.equal(await piece("e1"),"♔","King must not castle across attacked f1");
  // En passant is a capture from an empty destination and removes d5 pawn.
  await fen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  await move("e5","d6");
  assert.equal(await piece("d6"),"♙");assert.equal(await piece("d5"),"");
  // Promotion explicitly offers four legal piece choices instead of auto-queen.
  await fen("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  await move("a7","a8");
  assert.equal(await page.locator("#promotionChooser [data-promotion]").count(),4);
  await page.locator('#promotionChooser [data-promotion="N"]').click();
  assert.equal(await piece("a8"),"♘");
  assert.match(await page.locator("#moveList").innerText(),/=N/);
  // Both checkmate and stalemate, distinct outcomes.
  await fen("7k/6Q1/5K2/8/8/8/8/8 b - - 0 1");
  assert.equal(await page.evaluate(()=>window.__p111ChessTest.checkEnd()),true);
  assert.match(await page.locator("#turnText").innerText(),/白方将死获胜/);
  await fen("7k/5K2/6Q1/8/8/8/8/8 b - - 0 1");
  assert.equal(await page.evaluate(()=>window.__p111ChessTest.checkEnd()),true);
  assert.match(await page.locator("#turnText").innerText(),/逼和/);
  await fen("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
  assert.equal(await page.evaluate(()=>window.__p111ChessTest.checkEnd()),true);
  assert.match(await page.locator("#turnText").innerText(),/子力不足/);
  // Claims: 50-move rule or third position; automatic 75/fivefold rules.
  await fen("4k3/8/8/8/8/8/8/4K2R w K - 100 61");
  assert.equal(await page.locator("#drawClaimButton").isEnabled(),true);
  await page.locator("#game").evaluate(el=>el.classList.add("gs-tools-open"));await page.locator("#drawClaimButton").click();
  assert.match(await page.locator("#turnText").innerText(),/50 回合规则/);
  await fen("4k3/8/8/8/8/8/8/4K2R w K - 150 76");
  assert.equal(await page.evaluate(()=>window.__p111ChessTest.checkEnd()),true);
  assert.match(await page.locator("#turnText").innerText(),/75 回合规则/);
  await fen("4k1n1/8/8/8/8/8/8/4K1N1 w - - 0 1");
  for(let i=0;i<2;i++){
   await move("g1","f3");await move("g8","f6");
   await move("f3","g1");await move("f6","g8");
  }
  assert.equal((await st()).repetitions,3);
  assert.equal(await page.locator("#drawClaimButton").isEnabled(),true);
  await page.locator("#drawClaimButton").click();
  assert.match(await page.locator("#turnText").innerText(),/三次重复/);
  await page.goto(pathToFileURL(path.resolve(__dirname,"../app/games/gomoku/index.html")).href+"?p111Test=1");
  await page.waitForFunction(()=>!!window.__p111GomokuTest);
  const gomoku=page.evaluate(()=>window.__p111GomokuTest);
  const gomokuProfiles=await page.evaluate(()=>["easy","normal","hard"].map(level=>window.__p111GomokuTest.profile(level)));
  assert.deepEqual(gomokuProfiles.map(p=>p.plies),[0,1,3],"Gomoku difficulty levels must use distinct search strategies");
  assert.deepEqual(gomokuProfiles.map(p=>p.strategy),["tactical-random","weighted-greedy","beam-minimax"]);
  for(const level of ["easy","normal","hard"]){
   await page.evaluate(level=>window.__p111GomokuTest.loadPosition([[3,7,-1],[4,7,-1],[5,7,-1],[6,7,-1],[7,7,1]],level),level);
   assert.deepEqual(await page.evaluate(()=>window.__p111GomokuTest.choose()),[2,7],level+" AI must take an immediate winning move");
   await page.evaluate(level=>window.__p111GomokuTest.loadPosition([[3,7,1],[4,7,1],[5,7,1],[6,7,1],[7,7,-1]],level),level);
   assert.deepEqual(await page.evaluate(()=>window.__p111GomokuTest.choose()),[2,7],level+" AI must block the opponent's immediate win");
  }
  await page.evaluate(()=>window.__p111GomokuTest.loadPosition([[3,7,1],[4,7,1],[6,7,1]],"normal"));
  const patternScores=await page.evaluate(()=>({gap:window.__p111GomokuTest.scoreAt(5,7,1),quiet:window.__p111GomokuTest.scoreAt(5,5,1)}));
  assert.ok(patternScores.gap>patternScores.quiet*20,"Gomoku evaluation must recognize broken four-stone threats");
  await page.evaluate(()=>window.__p111GomokuTest.loadPosition([[7,7,1],[8,7,-1],[7,8,1],[8,8,-1],[6,7,1],[9,8,-1],[6,8,1],[9,7,-1]],"hard"));
  const hardTiming=await page.evaluate(()=>{const t=performance.now(),move=window.__p111GomokuTest.choose();return {move,ms:performance.now()-t};});
  assert.ok(Array.isArray(hardTiming.move)&&hardTiming.move.length===2,"Hard Gomoku AI must return a legal board coordinate");
  assert.ok(hardTiming.ms<1500,"Hard Gomoku beam search must stay responsive: "+JSON.stringify(hardTiming));
   // Reversi: opening legal moves, directional flips, illegal move rejection and AI legal move.
   const rv=await browser.newPage({viewport:{width:1120,height:860}});
   rv.on("pageerror",e=>errors.push("Reversi: "+e.message));
   await rv.goto(pathToFileURL(path.resolve(__dirname,"../app/games/reversi/index.html")).href+"?p111Test=1");
   await rv.waitForFunction(()=>!!window.__p111ReversiTest);
   const rvBoard=Array.from({length:8},()=>Array(8).fill(0));rvBoard[3][3]=rvBoard[4][4]=2;rvBoard[3][4]=rvBoard[4][3]=1;
   let rvState=await rv.evaluate(b=>window.__p111ReversiTest.loadBoard(b,1),rvBoard);
   assert.deepEqual(rvState.counts,{black:2,white:2});
   assert.deepEqual((await rv.evaluate(()=>window.__p111ReversiTest.legalMoves(1))).map(m=>[m.x,m.y]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),[[2,3],[3,2],[4,5],[5,4]],"Reversi opening must expose exactly four legal moves");
   rvState=await rv.evaluate(()=>window.__p111ReversiTest.play(2,3));
   assert.equal(rvState.board[3][2],1);assert.equal(rvState.board[3][3],1);assert.deepEqual(rvState.counts,{black:4,white:1});assert.equal(rvState.turn,2);
   const rvBefore=rvState.board;
   rvState=await rv.evaluate(()=>window.__p111ReversiTest.play(0,0));
   assert.deepEqual(rvState.board,rvBefore,"Illegal Reversi moves must not mutate the board");
   const rvCorner=Array.from({length:8},()=>Array(8).fill(0));rvCorner[0][1]=1;rvCorner[0][2]=2;
   await rv.evaluate(b=>window.__p111ReversiTest.loadBoard(b,2),rvCorner);await rv.evaluate(()=>window.__p111ReversiTest.setDifficulty("hard"));
   assert.deepEqual(await rv.evaluate(()=>window.__p111ReversiTest.choose()).then(m=>m&&[m.x,m.y]),[0,0],"Hard Reversi AI must take an available corner");
   await rv.close();

   // Connect Four: gravity, alternating turns, vertical win, immediate AI win/block.
   const c4=await browser.newPage({viewport:{width:1120,height:860}});
   c4.on("pageerror",e=>errors.push("Connect4: "+e.message));
   await c4.goto(pathToFileURL(path.resolve(__dirname,"../app/games/connect4/index.html")).href+"?p111Test=1");
   await c4.waitForFunction(()=>!!window.__p111Connect4Test);
   const c4Empty=()=>Array.from({length:6},()=>Array(7).fill(0));
   await c4.evaluate(b=>window.__p111Connect4Test.loadBoard(b,1),c4Empty());
   let c4State=await c4.evaluate(()=>window.__p111Connect4Test.play(0));
   assert.equal(c4State.board[5][0],1,"First Connect Four disc must fall to the bottom row");assert.equal(c4State.turn,2);
   for(const col of [1,0,1,0,1,0])c4State=await c4.evaluate(c=>window.__p111Connect4Test.play(c),col);
   assert.equal(c4State.over,true);assert.equal(c4State.winner,1,"Four vertically connected red discs must win");
   const c4Win=c4Empty();c4Win[5][0]=c4Win[5][1]=c4Win[5][2]=2;
   await c4.evaluate(b=>window.__p111Connect4Test.loadBoard(b,2),c4Win);await c4.evaluate(()=>window.__p111Connect4Test.setDifficulty("hard"));
   assert.equal(await c4.evaluate(()=>window.__p111Connect4Test.choose()),3,"Connect Four AI must take an immediate winning column");
   const c4Block=c4Empty();c4Block[5][0]=c4Block[5][1]=c4Block[5][2]=1;
   await c4.evaluate(b=>window.__p111Connect4Test.loadBoard(b,2),c4Block);
   assert.equal(await c4.evaluate(()=>window.__p111Connect4Test.choose()),3,"Connect Four AI must block an immediate opponent win");
   await c4.close();

   // Checkers: mandatory capture, forced multi-capture, promotion and AI legal capture.
   const ck=await browser.newPage({viewport:{width:1120,height:860}});
   ck.on("pageerror",e=>errors.push("Checkers: "+e.message));
   await ck.goto(pathToFileURL(path.resolve(__dirname,"../app/games/checkers/index.html")).href+"?p111Test=1");
   await ck.waitForFunction(()=>!!window.__p111CheckersTest);
   const ckEmpty=()=>Array.from({length:8},()=>Array(8).fill(0));
   const ckBoard=ckEmpty();ckBoard[5][0]=1;ckBoard[4][1]=2;ckBoard[2][3]=2;ckBoard[0][7]=4;
   let ckState=await ck.evaluate(b=>window.__p111CheckersTest.loadBoard(b,1),ckBoard);
   let ckMoves=await ck.evaluate(()=>window.__p111CheckersTest.legalMoves(1));
   assert.equal(ckMoves.length,1,"Checkers must force a capture when one is available");
   assert.deepEqual(ckMoves[0].capture,[1,4]);assert.deepEqual([ckMoves[0].tx,ckMoves[0].ty],[2,3]);
   ckState=await ck.evaluate(()=>window.__p111CheckersTest.playMove({x:0,y:5,tx:2,ty:3}));
   assert.deepEqual(ckState.continuing,{x:2,y:3},"A second capture must keep the same player moving");
   assert.equal(ckState.board[4][1],0);assert.equal(ckState.legal.length,1);
   ckState=await ck.evaluate(()=>window.__p111CheckersTest.playMove({x:2,y:3,tx:4,ty:1}));
   assert.equal(ckState.continuing,null);assert.equal(ckState.turn,2);assert.equal(ckState.board[2][3],0);assert.equal(ckState.board[1][4],1);
   const promotion=ckEmpty();promotion[1][0]=1;promotion[0][7]=4;
   ckState=await ck.evaluate(b=>window.__p111CheckersTest.loadBoard(b,1),promotion);
   ckState=await ck.evaluate(()=>window.__p111CheckersTest.playMove({x:0,y:1,tx:1,ty:0}));
   assert.equal(ckState.board[0][1],3,"A red man reaching the back rank must become a king");
   const aiCapture=ckEmpty();aiCapture[2][1]=2;aiCapture[3][2]=1;aiCapture[0][7]=4;
   await ck.evaluate(b=>window.__p111CheckersTest.loadBoard(b,2),aiCapture);await ck.evaluate(()=>window.__p111CheckersTest.setDifficulty("hard"));
   const ckAI=await ck.evaluate(()=>window.__p111CheckersTest.choose());
   assert.ok(ckAI&&ckAI.capture,"Checkers AI must choose from the forced-capture move set");
   await ck.close();
   // 2048: merge-once semantics, score, undo, no-op and win transition.
   const p2048=await browser.newPage({viewport:{width:900,height:900}});
   p2048.on("pageerror",e=>errors.push("2048: "+e.message));
   await p2048.goto(pathToFileURL(path.resolve(__dirname,"../app/games/2048/index.html")).href+"?p111Test=1");
   await p2048.waitForFunction(()=>!!window.__p1112048Test);
   const empty2048=()=>Array.from({length:4},()=>Array(4).fill(0));
   const mergeGrid=empty2048();mergeGrid[0]=[2,2,2,0];
   await p2048.evaluate(g=>window.__p1112048Test.loadGrid(g),mergeGrid);
   let p2048State=await p2048.evaluate(()=>window.__p1112048Test.move("left"));
   assert.deepEqual(p2048State.grid[0].slice(0,2),[4,2],"2048 must merge a tile only once per move");
   assert.equal(p2048State.score,4,"2048 score must increase by the merged tile value");
   assert.equal(p2048State.grid.flat().filter(Boolean).length,3,"A successful move must spawn exactly one new tile");
   p2048State=await p2048.evaluate(()=>window.__p1112048Test.undo());
   assert.deepEqual(p2048State.grid,mergeGrid,"2048 undo must restore the previous grid");assert.equal(p2048State.score,0);
   const noMoveGrid=empty2048();noMoveGrid[0][0]=2;
   await p2048.evaluate(g=>window.__p1112048Test.loadGrid(g),noMoveGrid);
   p2048State=await p2048.evaluate(()=>window.__p1112048Test.move("left"));
   assert.deepEqual(p2048State.grid,noMoveGrid,"An ineffective 2048 move must not spawn a tile");assert.equal(p2048State.previous,false);
   const winGrid=empty2048();winGrid[0]=[1024,1024,0,0];
   await p2048.evaluate(g=>window.__p1112048Test.loadGrid(g),winGrid);
   p2048State=await p2048.evaluate(()=>window.__p1112048Test.move("left"));
   assert.equal(p2048State.grid[0][0],2048);assert.equal(p2048State.won,true,"Merging to 2048 must set the win state");
   await p2048.close();

   // Snake: real keyboard input, reverse prevention, food growth, tail vacating and collisions.
   const snake=await browser.newPage({viewport:{width:900,height:700}});
   snake.on("pageerror",e=>errors.push("Snake: "+e.message));
   await snake.goto(pathToFileURL(path.resolve(__dirname,"../app/games/snake/index.html")).href+"?p111Test=1");
   await snake.waitForFunction(()=>!!window.__p111SnakeTest);
   const loadSnake=state=>snake.evaluate(s=>window.__p111SnakeTest.loadState(s),state);
   let snakeState=await loadSnake({snake:[{x:10,y:10},{x:9,y:10},{x:8,y:10}],dir:{x:1,y:0},food:{x:20,y:20},score:0,paused:false});
   await snake.keyboard.press("ArrowUp");snakeState=await snake.evaluate(()=>window.__p111SnakeTest.tick());
   assert.deepEqual(snakeState.snake[0],{x:10,y:9},"Snake must respond to ArrowUp input");
   await loadSnake({snake:[{x:10,y:10},{x:9,y:10},{x:8,y:10}],dir:{x:1,y:0},food:{x:20,y:20},score:0,paused:false});
   await snake.keyboard.press("ArrowLeft");snakeState=await snake.evaluate(()=>window.__p111SnakeTest.tick());
   assert.deepEqual(snakeState.snake[0],{x:11,y:10},"Snake must reject an immediate 180-degree reversal");
   await loadSnake({snake:[{x:5,y:5},{x:4,y:5},{x:3,y:5}],dir:{x:1,y:0},food:{x:6,y:5},score:0,paused:false});
   snakeState=await snake.evaluate(()=>window.__p111SnakeTest.tick());
   assert.equal(snakeState.snake.length,4);assert.equal(snakeState.score,10);assert.deepEqual(snakeState.snake[0],{x:6,y:5},"Eating food must grow the snake and award points");
   await loadSnake({snake:[{x:5,y:5},{x:5,y:6},{x:4,y:6},{x:4,y:5}],dir:{x:-1,y:0},food:{x:20,y:20},score:0,paused:false});
   snakeState=await snake.evaluate(()=>window.__p111SnakeTest.tick());
   assert.equal(snakeState.over,false,"Moving into the vacating tail cell must remain legal");assert.deepEqual(snakeState.snake[0],{x:4,y:5});
   await loadSnake({snake:[{x:23,y:10},{x:22,y:10}],dir:{x:1,y:0},food:{x:0,y:0},score:0,paused:false});
   snakeState=await snake.evaluate(()=>window.__p111SnakeTest.tick());
   assert.equal(snakeState.over,true,"Crossing the board boundary must end Snake");assert.equal(snakeState.paused,true);
   await loadSnake({snake:[{x:5,y:5},{x:5,y:6},{x:4,y:6},{x:4,y:5}],dir:{x:0,y:1},food:{x:20,y:20},score:0,paused:false});
   snakeState=await snake.evaluate(()=>window.__p111SnakeTest.tick());
   assert.equal(snakeState.over,true,"Running into the body must end Snake");
   await snake.close();
  // Memory: deterministic matching, mismatch lockout, timeout flip-back and complete-deck win.
  const memory=await browser.newPage({viewport:{width:900,height:700}});
  memory.on("pageerror",e=>errors.push("Memory: "+e.message));
  await memory.goto(pathToFileURL(path.resolve(__dirname,"../app/games/memory/index.html")).href+"?p111Test=1");
  await memory.waitForFunction(()=>!!window.__p111MemoryTest);
  let memoryState=await memory.evaluate(()=>window.__p111MemoryTest.loadDeck(["A","B"]));
  memoryState=await memory.evaluate(()=>window.__p111MemoryTest.flip(0));
  memoryState=await memory.evaluate(()=>window.__p111MemoryTest.flip(1));
  assert.equal(memoryState.locked,true);assert.equal(memoryState.moves,1);assert.deepEqual(memoryState.opened,[0,1]);
  memoryState=await memory.evaluate(()=>window.__p111MemoryTest.flip(2));
  assert.deepEqual(memoryState.opened,[0,1],"Memory must ignore further flips while a mismatch is locked");assert.equal(memoryState.moves,1);
  await memory.waitForTimeout(800);memoryState=await memory.evaluate(()=>window.__p111MemoryTest.state());
  assert.equal(memoryState.locked,false);assert.deepEqual(memoryState.opened,[]);assert.equal(memoryState.cards[0].open,false);assert.equal(memoryState.cards[1].open,false);
  memoryState=await memory.evaluate(()=>window.__p111MemoryTest.flip(0));memoryState=await memory.evaluate(()=>window.__p111MemoryTest.flip(2));
  assert.equal(memoryState.matched,1);assert.equal(memoryState.cards[0].matched,true);assert.equal(memoryState.cards[2].matched,true);
  memoryState=await memory.evaluate(()=>window.__p111MemoryTest.flip(1));memoryState=await memory.evaluate(()=>window.__p111MemoryTest.flip(3));
  assert.equal(memoryState.matched,2);assert.equal(memoryState.moves,3);assert.ok(memoryState.cards.every(card=>card.matched),"All Memory pairs must finish the game");
  await memory.close();

  // Sokoban: push onto goal, win state, undo, normal movement and wall blocking.
  const sokoban=await browser.newPage({viewport:{width:900,height:700}});
  sokoban.on("pageerror",e=>errors.push("Sokoban: "+e.message));
  await sokoban.goto(pathToFileURL(path.resolve(__dirname,"../app/games/sokoban/index.html")).href+"?p111Test=1");
  await sokoban.waitForFunction(()=>!!window.__p111SokobanTest);
  let boxState=await sokoban.evaluate(()=>window.__p111SokobanTest.loadLevel(0));
  assert.equal(boxState.player,40);assert.deepEqual(boxState.boxes,[31]);assert.deepEqual(boxState.goals,[22]);
  boxState=await sokoban.evaluate(()=>window.__p111SokobanTest.move(0,-1));
  assert.equal(boxState.player,31);assert.deepEqual(boxState.boxes,[22]);assert.equal(boxState.complete,true);assert.equal(boxState.moves,1);
  boxState=await sokoban.evaluate(()=>window.__p111SokobanTest.undo());
  assert.equal(boxState.player,40);assert.deepEqual(boxState.boxes,[31]);assert.equal(boxState.complete,false);assert.equal(boxState.moves,0);
  for(let i=0;i<3;i++)boxState=await sokoban.evaluate(()=>window.__p111SokobanTest.move(-1,0));
  assert.equal(boxState.player,37);assert.equal(boxState.moves,3);
  const beforeWall={player:boxState.player,moves:boxState.moves};
  boxState=await sokoban.evaluate(()=>window.__p111SokobanTest.move(-1,0));
  assert.equal(boxState.player,beforeWall.player,"Sokoban must not move through a wall");assert.equal(boxState.moves,beforeWall.moves);
  boxState=await sokoban.evaluate(()=>window.__p111SokobanTest.undo());
  assert.equal(boxState.player,38);assert.equal(boxState.moves,2);
  await sokoban.close();

  // Sudoku: given-cell protection, error detection and exact-solution completion.
  const sudoku=await browser.newPage({viewport:{width:900,height:900}});
  sudoku.on("pageerror",e=>errors.push("Sudoku: "+e.message));
  await sudoku.goto(pathToFileURL(path.resolve(__dirname,"../app/games/sudoku/index.html")).href+"?p111Test=1");
  await sudoku.waitForFunction(()=>!!window.__p111SudokuTest);
  const sudokuSolution=[
   [5,3,4,6,7,8,9,1,2],[6,7,2,1,9,5,3,4,8],[1,9,8,3,4,2,5,6,7],
   [8,5,9,7,6,1,4,2,3],[4,2,6,8,5,3,7,9,1],[7,1,3,9,2,4,8,5,6],
   [9,6,1,5,3,7,2,8,4],[2,8,7,4,1,9,6,3,5],[3,4,5,2,8,6,1,7,9]
  ];
  const sudokuPuzzle=sudokuSolution.map(row=>row.slice());sudokuPuzzle[0][0]=0;sudokuPuzzle[0][1]=0;
  let sudokuState=await sudoku.evaluate(([p,s])=>window.__p111SudokuTest.loadPuzzle(p,s),[sudokuPuzzle,sudokuSolution]);
  sudokuState=await sudoku.evaluate(()=>window.__p111SudokuTest.select(2));sudokuState=await sudoku.evaluate(()=>window.__p111SudokuTest.put(1));
  assert.equal(sudokuState.puzzle[0][2],4,"Sudoku must protect given clues");
  sudokuState=await sudoku.evaluate(()=>window.__p111SudokuTest.select(0));sudokuState=await sudoku.evaluate(()=>window.__p111SudokuTest.put(4));
  sudokuState=await sudoku.evaluate(()=>window.__p111SudokuTest.check());
  assert.ok(sudokuState.status.includes("发现 1 个错误"),"Sudoku check must identify incorrect entries");
  sudokuState=await sudoku.evaluate(()=>window.__p111SudokuTest.select(1));sudokuState=await sudoku.evaluate(()=>window.__p111SudokuTest.put(3));
  sudokuState=await sudoku.evaluate(()=>window.__p111SudokuTest.select(0));sudokuState=await sudoku.evaluate(()=>window.__p111SudokuTest.put(5));
  assert.equal(sudokuState.over,true);assert.deepEqual(sudokuState.puzzle,sudokuSolution,"Sudoku must finish only when every cell matches the solution");
  await sudoku.close();
  // Pong: keyboard paddle control, paddle/wall bounce, scoring and distinct AI response speeds.
  const pong=await browser.newPage({viewport:{width:900,height:600}});
  pong.on("pageerror",e=>errors.push("Pong: "+e.message));
  await pong.goto(pathToFileURL(path.resolve(__dirname,"../app/games/pong/index.html")).href+"?p111Test=1");
  await pong.waitForFunction(()=>!!window.__p111PongTest);
  const pongLoad=s=>pong.evaluate(v=>window.__p111PongTest.loadState(v),s);
  let pongState=await pongLoad({playerY:145,aiY:145,ball:{x:30,y:180,vx:-5,vy:0},ps:0,as:0,difficulty:"normal"});
  pongState=await pong.evaluate(()=>window.__p111PongTest.step());
  assert.ok(pongState.ball.vx>0,"Pong ball must bounce off the player paddle");
  await pongLoad({playerY:145,aiY:145,ball:{x:300,y:8,vx:1,vy:-4},ps:0,as:0,difficulty:"normal"});
  pongState=await pong.evaluate(()=>window.__p111PongTest.step());
  assert.ok(pongState.ball.vy>0,"Pong ball must bounce off the top wall");
  await pongLoad({playerY:145,aiY:145,ball:{x:2,y:180,vx:-4,vy:0},ps:0,as:0,difficulty:"normal"});
  pongState=await pong.evaluate(()=>window.__p111PongTest.step());
  assert.equal(pongState.aiScore,1,"A ball passing the player side must score for the AI");
  await pongLoad({playerY:145,aiY:145,ball:{x:2,y:180,vx:-4,vy:0},ps:0,as:6,difficulty:"normal"});
  pongState=await pong.evaluate(()=>window.__p111PongTest.step());
  assert.equal(pongState.over,true);assert.equal(pongState.aiScore,7,"Pong must end at seven points");
  await pongLoad({playerY:145,aiY:0,ball:{x:320,y:300,vx:1,vy:0},ps:0,as:0,difficulty:"easy"});
  const easyAi=(await pong.evaluate(()=>window.__p111PongTest.step())).aiY;
  await pongLoad({playerY:145,aiY:0,ball:{x:320,y:300,vx:1,vy:0},ps:0,as:0,difficulty:"hard"});
  const hardAi=(await pong.evaluate(()=>window.__p111PongTest.step())).aiY;
  assert.ok(hardAi>easyAi+3,"Hard Pong AI must move faster than easy AI in the same fixture");
  await pongLoad({playerY:145,aiY:145,ball:{x:320,y:180,vx:1,vy:0},ps:0,as:0,difficulty:"normal"});
  await pong.keyboard.down("ArrowUp");pongState=await pong.evaluate(()=>window.__p111PongTest.step());await pong.keyboard.up("ArrowUp");
  assert.equal(pongState.playerY,139,"Pong player paddle must respond to the real ArrowUp key");
  await pong.close();
   // Minesweeper: first-click safety, flood fill, flag counter and chord correctness.
   const mine=await browser.newPage({viewport:{width:900,height:700}});
   mine.on("pageerror",e=>errors.push("Minesweeper: "+e.message));
   await mine.goto(pathToFileURL(path.resolve(__dirname,"../app/games/minesweeper/index.html")).href+"?p111Test=1");
   await mine.waitForFunction(()=>!!window.__p111MineTest);
   let mineState=await mine.evaluate(()=>window.__p111MineTest.loadBoard({width:3,height:3,mines:[0]}));
   mineState=await mine.evaluate(()=>window.__p111MineTest.reveal(0));
   assert.equal(mineState.started,true);assert.equal(mineState.cells[0].open,true);assert.equal(mineState.cells[0].mine,false,"Minesweeper first click must never detonate");
   await mine.evaluate(()=>window.__p111MineTest.stopTimer());
   mineState=await mine.evaluate(()=>window.__p111MineTest.loadBoard({width:3,height:3,mines:[]}));
   mineState=await mine.evaluate(()=>window.__p111MineTest.reveal(4));
   assert.equal(mineState.opened,9);assert.equal(mineState.over,true,"Flood fill must reveal every safe cell on an empty board");
   mineState=await mine.evaluate(()=>window.__p111MineTest.loadBoard({width:3,height:3,mines:[1]}));
   mineState=await mine.evaluate(()=>window.__p111MineTest.reveal(0));
   mineState=await mine.evaluate(()=>window.__p111MineTest.toggleFlag(1));
   assert.equal(mineState.flags,1);mineState=await mine.evaluate(()=>window.__p111MineTest.chord(0));
   assert.equal(mineState.over,false);assert.equal(mineState.cells[3].open,true);assert.equal(mineState.cells[4].open,true,"A correctly flagged chord must open covered neighbours");
   mineState=await mine.evaluate(()=>window.__p111MineTest.loadBoard({width:3,height:3,mines:[1]}));
   mineState=await mine.evaluate(()=>window.__p111MineTest.reveal(0));mineState=await mine.evaluate(()=>window.__p111MineTest.toggleFlag(3));
   mineState=await mine.evaluate(()=>window.__p111MineTest.chord(0));
   assert.equal(mineState.over,true);assert.equal(mineState.cells[1].open,true,"An incorrectly flagged chord must reveal the mine and end the game");
   await mine.close();

   // Battleship: fleet geometry, hit/miss, duplicate-shot rejection, victory and target pursuit.
   const sea=await browser.newPage({viewport:{width:1100,height:800}});
   sea.on("pageerror",e=>errors.push("Battleship: "+e.message));
   await sea.goto(pathToFileURL(path.resolve(__dirname,"../app/games/battleship/index.html")).href+"?p111Test=1");
   await sea.waitForFunction(()=>!!window.__p111BattleshipTest);
   const seaEmpty=()=>Array.from({length:10},()=>Array(10).fill(0));
   const generatedFleet=await sea.evaluate(()=>window.__p111BattleshipTest.makeFleet());
   assert.equal(generatedFleet.grid.flat().filter(v=>v>0).length,17,"Battleship fleet must contain 17 ship cells");
   assert.deepEqual(Object.values(generatedFleet.lengths).sort((a,b)=>a-b),[2,3,3,4,5]);
   for(let y=0;y<10;y++)for(let x=0;x<10;x++)if(generatedFleet.grid[y][x])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<10&&yy>=0&&yy<10&&generatedFleet.grid[yy][xx]&&generatedFleet.grid[yy][xx]!==generatedFleet.grid[y][x])assert.fail("Battleship ships must not touch, including diagonally");}
   const seaOwn=seaEmpty(),seaEnemy=seaEmpty();seaEnemy[0][0]=1;
   let seaState=await sea.evaluate(s=>window.__p111BattleshipTest.loadState(s),{ownFleet:seaEmpty(),enemyFleet:seaEnemy,remainingShips:[5,4,3,3,2]});
   seaState=await sea.evaluate(()=>window.__p111BattleshipTest.attack(0,0));assert.equal(seaState.enemy[0][0],1);assert.equal(seaState.hits,1);assert.equal(seaState.shots,1);
   seaState=await sea.evaluate(()=>window.__p111BattleshipTest.attack(1,0));assert.equal(seaState.enemy[0][1],2);assert.equal(seaState.shots,2);
   seaState=await sea.evaluate(()=>window.__p111BattleshipTest.attack(1,0));assert.equal(seaState.shots,2,"Battleship must reject duplicate shots");
   const winEnemy=seaEmpty();winEnemy[0][0]=1;
   seaState=await sea.evaluate(s=>window.__p111BattleshipTest.loadState(s),{ownFleet:seaEmpty(),enemyFleet:winEnemy,remainingShips:[5,4,3,3,2],hits:16,shots:16});
   seaState=await sea.evaluate(()=>window.__p111BattleshipTest.attack(0,0));assert.equal(seaState.over,true);assert.equal(seaState.hits,17,"Sinking all 17 ship cells must win Battleship");
   const aiFleet=seaEmpty();aiFleet[5][5]=aiFleet[5][6]=1;const aiOwn=seaEmpty();aiOwn[5][5]=-1;for(let y=0;y<10;y++)for(let x=0;x<10;x++)if(!(y===5&&x===6)&&!(y===5&&x===5))aiOwn[y][x]=-2;
   seaState=await sea.evaluate(s=>window.__p111BattleshipTest.loadState(s),{ownFleet:aiFleet,enemyFleet:seaEmpty(),own:aiOwn,remainingShips:[2],difficulty:"normal"});
   seaState=await sea.evaluate(()=>window.__p111BattleshipTest.ai());assert.equal(seaState.own[5][6],-3);assert.deepEqual(seaState.remainingShips,[],"Battleship AI must finish a ship after pursuing an adjacent hit");
   await sea.close();

   // Tetris: wall bounds, rotation, hard drop, line clear scoring and top-out.
   const tetris=await browser.newPage({viewport:{width:900,height:900}});
   tetris.on("pageerror",e=>errors.push("Tetris: "+e.message));
   await tetris.goto(pathToFileURL(path.resolve(__dirname,"../app/games/tetris/index.html")).href+"?p111Test=1");
   await tetris.waitForFunction(()=>!!window.__p111TetrisTest);
   const emptyTetris=()=>Array.from({length:20},()=>Array(10).fill(0));
   const single=(x,y)=>({kind:3,shape:[[1]],x,y,color:"#ffffff"});
   let tetState=await tetris.evaluate(s=>window.__p111TetrisTest.loadState(s),{grid:emptyTetris(),piece:{kind:0,shape:[[1,1,1,1]],x:3,y:0,color:"#ffffff"},nextPiece:single(4,0)});
   tetState=await tetris.evaluate(()=>window.__p111TetrisTest.rotate());assert.equal(tetState.piece.shape.length,4);assert.equal(tetState.piece.shape[0].length,1,"Tetris I-piece rotation must change horizontal to vertical");
   tetState=await tetris.evaluate(s=>window.__p111TetrisTest.loadState(s),{grid:emptyTetris(),piece:single(0,0),nextPiece:single(4,0)});
   tetState=await tetris.evaluate(()=>window.__p111TetrisTest.move(-1,0));assert.equal(tetState.piece.x,0,"Tetris pieces must not move through the left wall");
   const clearGrid=emptyTetris();clearGrid[19]=Array(10).fill("#777777");clearGrid[19][4]=0;
   tetState=await tetris.evaluate(s=>window.__p111TetrisTest.loadState(s),{grid:clearGrid,piece:single(4,18),nextPiece:single(4,0)});
   tetState=await tetris.evaluate(()=>window.__p111TetrisTest.hardDrop());assert.equal(tetState.lines,1);assert.equal(tetState.score,102,"A one-cell hard drop that clears one line must score drop distance plus line points");assert.ok(tetState.grid[19].every(v=>!v),"Cleared Tetris row must be replaced by an empty row");
   const topGrid=emptyTetris();topGrid[0][4]="#777777";
   tetState=await tetris.evaluate(s=>window.__p111TetrisTest.loadState(s),{grid:topGrid,piece:single(4,18),nextPiece:single(4,0)});
   tetState=await tetris.evaluate(()=>window.__p111TetrisTest.hardDrop());assert.equal(tetState.over,true,"A spawned piece colliding with occupied spawn cells must top out");
   await tetris.close();

   // Klondike: 52-card deal, stock recycle, alternating-color descent, invalid move and face-up reveal.
   const solitaire=await browser.newPage({viewport:{width:1100,height:850}});
   solitaire.on("pageerror",e=>errors.push("Solitaire: "+e.message));
   await solitaire.goto(pathToFileURL(path.resolve(__dirname,"../app/games/solitaire/index.html")).href+"?p111Test=1");
   await solitaire.waitForFunction(()=>!!window.__p111SolitaireTest);
   let solState=await solitaire.evaluate(()=>window.__p111SolitaireTest.newGame());
   const dealt=[...solState.stock,...solState.waste,...solState.columns.flat()];
   assert.equal(dealt.length,52);assert.equal(new Set(dealt.map(c=>c.suit+c.rank)).size,52,"Klondike must deal a unique 52-card deck");
   assert.deepEqual(solState.columns.map(c=>c.length),[1,2,3,4,5,6,7]);assert.equal(solState.stock.length,24);
   const card=(suit,rank,face=true)=>({suit,rank,face});
   solState=await solitaire.evaluate(s=>window.__p111SolitaireTest.loadState(s),{stock:[card("♠",1,false)],waste:[],columns:Array.from({length:7},()=>[])});
   solState=await solitaire.evaluate(()=>window.__p111SolitaireTest.draw());assert.equal(solState.waste.length,1);assert.equal(solState.waste[0].face,true);
   solState=await solitaire.evaluate(()=>window.__p111SolitaireTest.draw());assert.equal(solState.stock.length,1);assert.equal(solState.stock[0].face,false);assert.equal(solState.waste.length,0,"An empty stock must recycle the waste pile face-down");
   solState=await solitaire.evaluate(s=>window.__p111SolitaireTest.loadState(s),{stock:[],waste:[card("♥",6)],columns:[[card("♠",7)],[],[],[],[],[],[]]});
   solState=await solitaire.evaluate(()=>window.__p111SolitaireTest.chooseWaste());solState=await solitaire.evaluate(()=>window.__p111SolitaireTest.place(0));
   assert.equal(solState.columns[0].length,2);assert.equal(solState.columns[0][1].rank,6);assert.equal(solState.moves,1);assert.equal(solState.waste.length,0,"A red six may be placed on a black seven");
   solState=await solitaire.evaluate(s=>window.__p111SolitaireTest.loadState(s),{stock:[],waste:[card("♣",6)],columns:[[card("♠",7)],[],[],[],[],[],[]]});
   await solitaire.evaluate(()=>window.__p111SolitaireTest.chooseWaste());solState=await solitaire.evaluate(()=>window.__p111SolitaireTest.place(0));
   assert.equal(solState.columns[0].length,1);assert.equal(solState.waste.length,1);assert.equal(solState.moves,0,"A same-color tableau move must be rejected");
   solState=await solitaire.evaluate(s=>window.__p111SolitaireTest.loadState(s),{stock:[],waste:[],columns:[[card("♣",8,false),card("♥",9)], [card("♠",10)],[],[],[],[],[]]});
   await solitaire.evaluate(()=>window.__p111SolitaireTest.chooseColumn(0,1));solState=await solitaire.evaluate(()=>window.__p111SolitaireTest.place(1));
   assert.equal(solState.columns[0][0].face,true,"Moving the top card must reveal the previous tableau card");assert.equal(solState.columns[1].length,2);
   solState=await solitaire.evaluate(s=>window.__p111SolitaireTest.loadState(s),{stock:[],waste:[card("♥",1)],foundations:[[],[],[],[]],columns:Array.from({length:7},()=>[])});
   let solMove=await solitaire.evaluate(()=>window.__p111SolitaireTest.move("waste","foundation-0"));assert.equal(solMove.moved,true);assert.equal(solMove.foundations[0][0].rank,1,"Klondike foundations must start with an Ace");
   solState=await solitaire.evaluate(s=>window.__p111SolitaireTest.loadState(s),{stock:[],waste:[card("♥",2)],foundations:[[card("♥",1)],[],[],[]],columns:Array.from({length:7},()=>[])});
   solMove=await solitaire.evaluate(()=>window.__p111SolitaireTest.move("waste","foundation-0"));assert.equal(solMove.moved,true);assert.equal(solMove.foundations[0].length,2,"A foundation must ascend by one in the same suit");
   const completeFoundations=["♥","♦","♣","♠"].map(suit=>Array.from({length:13},(_,i)=>card(suit,i+1)));
   solState=await solitaire.evaluate(f=>window.__p111SolitaireTest.loadState({foundations:f,columns:Array.from({length:7},()=>[])}),completeFoundations);
   solState=await solitaire.evaluate(()=>window.__p111SolitaireTest.checkWin());assert.equal(solState.won,true,"Four complete foundations must finish Klondike");
   await solitaire.close();
   // Contra-style original shooter: difficulty lives, weapon spread, grenade, invulnerability and stage progression.
   const contra=await browser.newPage({viewport:{width:1100,height:700}});contra.on("pageerror",e=>errors.push("Contra: "+e.message));
   await contra.goto(pathToFileURL(path.resolve(__dirname,"../app/games/contra/index.html")).href+"?p111Test=1");await contra.waitForFunction(()=>!!window.__p111ContraTest);
   let contraState=await contra.evaluate(()=>window.__p111ContraTest.start("easy"));assert.equal(contraState.lives,5);assert.equal(contraState.paused,true);
   contraState=await contra.evaluate(()=>window.__p111ContraTest.start("hard"));assert.equal(contraState.lives,2,"Hard Contra mode must start with two lives");
   contraState=await contra.evaluate(()=>window.__p111ContraTest.loadState({weapon:"fan",grenadeCount:3}));contraState=await contra.evaluate(()=>window.__p111ContraTest.fire());assert.equal(contraState.bullets.length,3,"Fan weapon must fire three projectiles");
   contraState=await contra.evaluate(()=>window.__p111ContraTest.throwGrenade());assert.equal(contraState.grenadeCount,2);assert.equal(contraState.grenades.length,1);
   contraState=await contra.evaluate(()=>window.__p111ContraTest.loadState({lives:2,player:{inv:0}}));contraState=await contra.evaluate(()=>window.__p111ContraTest.hitPlayer());assert.equal(contraState.lives,1);
   contraState=await contra.evaluate(()=>window.__p111ContraTest.hitPlayer());assert.equal(contraState.lives,1,"Contra invulnerability must prevent repeated immediate damage");
   contraState=await contra.evaluate(()=>window.__p111ContraTest.loadState({stage:1,weapon:"rifle"}));contraState=await contra.evaluate(()=>window.__p111ContraTest.nextStage());assert.equal(contraState.stage,2);assert.equal(contraState.weapon,"fan");
   contraState=await contra.evaluate(()=>window.__p111ContraTest.loadState({stage:3,score:100}));contraState=await contra.evaluate(()=>window.__p111ContraTest.nextStage());assert.equal(contraState.over,true);assert.equal(contraState.score,600,"Completing the final Contra area must award the clear bonus");
   contraState=await contra.evaluate(()=>window.__p111ContraTest.loadState({boss:{x:100,y:100,w:100,h:100,hp:20,maxHp:20}}));contraState=await contra.evaluate(()=>window.__p111ContraTest.explode(150,150));assert.equal(contraState.boss.hp,13,"Grenade explosion must damage a nearby boss");await contra.close();

   // Original platform game: movement, jump physics, platform landing, coin pickup, stomp, damage immunity and goal.
   const mario=await browser.newPage({viewport:{width:1100,height:750}});mario.on("pageerror",e=>errors.push("Mario: "+e.message));
   await mario.goto(pathToFileURL(path.resolve(__dirname,"../app/games/mario/index.html")).href+"?p111Test=1");await mario.waitForFunction(()=>!!window.__p111MarioTest);
   let marioState=await mario.evaluate(()=>window.__p111MarioTest.loadState({player:{x:70,y:410,onGround:true},coins:[{x:100,y:430,got:false,phase:0}],enemies:[],platforms:[]}));
   await mario.evaluate(()=>window.__p111MarioTest.setKeys({d:true}));marioState=await mario.evaluate(()=>window.__p111MarioTest.update(1));assert.ok(marioState.player.x>70);assert.equal(marioState.coinCount,1);assert.equal(marioState.score,100,"Mario must collect coins and award 100 points");
   marioState=await mario.evaluate(()=>window.__p111MarioTest.loadState({player:{x:70,y:410,onGround:true},coins:[],enemies:[],platforms:[]}));await mario.evaluate(()=>window.__p111MarioTest.setKeys({jump:true}));marioState=await mario.evaluate(()=>window.__p111MarioTest.update(1));assert.ok(marioState.player.y<410&&marioState.player.vy<0,"Mario jump input must create upward velocity");
   marioState=await mario.evaluate(()=>window.__p111MarioTest.loadState({player:{x:270,y:300,vy:0,onGround:false},platforms:[{x:260,y:365,w:130,h:18}],coins:[],enemies:[]}));for(let i=0;i<10;i++)marioState=await mario.evaluate(()=>window.__p111MarioTest.update(1));assert.equal(marioState.player.onGround,true);assert.equal(marioState.player.y,321,"Mario must land on top of a platform");
   marioState=await mario.evaluate(()=>window.__p111MarioTest.loadState({player:{x:100,y:380,vy:5,onGround:false,face:1},platforms:[],coins:[],enemies:[{x:100,y:427,dir:0,min:100,max:100,alive:true}]}));marioState=await mario.evaluate(()=>window.__p111MarioTest.update(1));assert.equal(marioState.enemies[0].alive,false);assert.equal(marioState.score,200,"Landing on an enemy must defeat it and award points");
   marioState=await mario.evaluate(()=>window.__p111MarioTest.loadState({lives:2,invuln:0,player:{x:70,y:410,onGround:true},coins:[],enemies:[],platforms:[]}));marioState=await mario.evaluate(()=>window.__p111MarioTest.hit());assert.equal(marioState.lives,1);marioState=await mario.evaluate(()=>window.__p111MarioTest.hit());assert.equal(marioState.lives,1,"Mario damage immunity must block repeated immediate hits");
   marioState=await mario.evaluate(()=>window.__p111MarioTest.loadState({player:{x:3261,y:410,onGround:true},coins:[],enemies:[],platforms:[]}));marioState=await mario.evaluate(()=>window.__p111MarioTest.update(.1));assert.equal(marioState.over,true,"Reaching the level goal must finish the stage");await mario.close();

   // Tank battle: map collision, boundary blocking, firing direction, enemy hit and base protection.
   const tank=await browser.newPage({viewport:{width:1000,height:850}});tank.on("pageerror",e=>errors.push("Tank: "+e.message));
   await tank.goto(pathToFileURL(path.resolve(__dirname,"../app/games/tank/index.html")).href+"?p111Test=1");await tank.waitForFunction(()=>!!window.__p111TankTest);
   let tankState=await tank.evaluate(()=>window.__p111TankTest.loadState());let tankMove=await tank.evaluate(()=>window.__p111TankTest.move("up"));assert.equal(tankMove.moved,false,"Tank must not pass through brick walls");
   tankState=await tank.evaluate(()=>window.__p111TankTest.loadState({player:{x:5,y:6,dir:"up",enemy:false,alive:true}}));tankMove=await tank.evaluate(()=>window.__p111TankTest.move("right"));assert.equal(tankMove.moved,false,"Tank must not pass through water");
   tankState=await tank.evaluate(()=>window.__p111TankTest.loadState({player:{x:0,y:0,dir:"up",enemy:false,alive:true}}));tankMove=await tank.evaluate(()=>window.__p111TankTest.move("left"));assert.equal(tankMove.moved,false,"Tank must remain inside the map boundary");
   tankState=await tank.evaluate(()=>window.__p111TankTest.loadState({player:{x:2,y:2,dir:"right",enemy:false,alive:true}}));tankState=await tank.evaluate(()=>window.__p111TankTest.fire());assert.ok(tankState.bullets[0].vx>0,"Tank fire must follow its facing direction");
   tankState=await tank.evaluate(()=>window.__p111TankTest.loadState({player:{x:7,y:12,dir:"up",enemy:false,alive:true},enemies:[{x:3,y:3,dir:"up",enemy:true,alive:true}]}));tankState=await tank.evaluate(()=>window.__p111TankTest.hitEnemy());assert.equal(tankState.kills,1);assert.equal(tankState.enemies[0].alive,false,"A player projectile must destroy an enemy tank");
   const baseBullet={x:7.5*39,y:15.5*39,vx:0,vy:0,enemy:true,dead:false};tankState=await tank.evaluate(b=>window.__p111TankTest.loadState({spawned:20,bullets:[b]}),baseBullet);tankState=await tank.evaluate(()=>window.__p111TankTest.update(.01));assert.equal(tankState.baseAlive,false);assert.equal(tankState.over,true,"An enemy projectile reaching the base must end the mission");await tank.close();
  const star=await browser.newPage({viewport:{width:1150,height:880}});
  star.on("pageerror",e=>errors.push("ChineseCheckers: "+e.message));
  await star.goto(pathToFileURL(path.resolve(__dirname,"../app/games/chinese-checkers/index.html")).href+"?p111Test=1");
  await star.waitForFunction(()=>!!window.__p111StarTest);
  const starState=()=>star.evaluate(()=>window.__p111StarTest.state());
  assert.equal(await star.evaluate(()=>window.__p111StarTest.count()),121,"Chinese Checkers requires exactly 121 holes");
  assert.deepEqual(await star.evaluate(()=>window.__p111StarTest.arms()),[10,10,10,10,10,10],"Each six-pointed star arm has 10 holes");
  assert.equal((await starState()).pieces,20,"Two players start with ten pieces each");

  // Standard 2/3/4/6-player Chinese Checkers configurations and turn perspective.
  for(const count of [2,3,4,6]){
   await star.evaluate(n=>window.__p111StarTest.players(n),count);
   const state=await starState();
   assert.equal(state.playerCount,count,"Selected number of participants must apply");
   assert.equal(state.pieces,count*10,"Each participant needs ten marbles");
   assert.equal(new Set(state.activeArms).size,count,"All active camps must be distinct");
   assert.equal(await star.locator(".star-seat-marker").count(),count,"Only occupied Chinese Checkers seats get numbers");
   assert.deepEqual(await star.locator(".star-seat-marker").evaluateAll(els=>els.map(el=>Number(el.dataset.position))),Array.from({length:count},(_,i)=>i+1),"Seat numbers progress counterclockwise from player 1");
   assert.equal(await star.locator(".star-seat-marker.is-current").count(),1,"Only one active seat flashes");
   assert.equal(await star.locator("#starCounters .reversi-count-row").count(),count,"Each player gets a scoreboard row");
   const backgrounds=await star.locator("#starCounters .star-count-disc").evaluateAll(els=>els.map(el=>getComputedStyle(el).backgroundImage));
   assert.equal(new Set(backgrounds).size,count,"All active sides must have distinct marble colors");
  }
  await star.evaluate(()=>{const t=window.__p111StarTest;t.mode("two");t.players(6);});
  const sixMove=await star.evaluate(()=>window.__p111StarTest.moves(0)[0]);
  assert.ok(sixMove,"Six players must be able to start playing");
  assert.equal(await star.evaluate(m=>window.__p111StarTest.move(m),sixMove),true);
  assert.equal((await starState()).turn,1,"Six-player moves must rotate to the next seat");
  assert.equal((await starState()).viewSeat,0,"The Chinese Checkers board must never rotate after a turn");
  assert.equal(await star.locator(".star-seat-marker.is-current").getAttribute("data-position"),"2","Current turn highlights seat 2 without rotating the board");
  await star.evaluate(()=>window.__p111StarTest.undo());
  assert.equal((await starState()).viewSeat,0,"Undo must preserve the fixed board direction");
  assert.equal(await star.locator(".star-seat-marker.is-current").getAttribute("data-position"),"1","Undo restores seat-one highlight");
  await star.evaluate(()=>{const t=window.__p111StarTest;t.players(6);t.mode("ai");});
  const humanMove=await star.evaluate(()=>window.__p111StarTest.moves(0)[0]);
  assert.equal(await star.evaluate(m=>window.__p111StarTest.move(m),humanMove),true);
  assert.equal(await star.evaluate(()=>window.__p111StarTest.computer()),true,"AI mode takes all nonhuman seats");
  assert.equal(await star.evaluate(()=>window.__p111StarTest.ai()),true,"Seat 2 AI must move");
  assert.equal((await starState()).turn,2,"After AI seat 2, seat 3 is next");
  await star.evaluate(()=>window.__p111StarTest.mode("two"));
  await star.evaluate(()=>window.__p111StarTest.players(2));

  const starProfiles=await star.evaluate(()=>["easy","normal","hard"].map(level=>window.__p111StarTest.aiProfile(level)));
  assert.deepEqual(starProfiles.map(p=>p.replyDepth),[0,0,1],"Hard Chinese Checkers AI evaluates an opponent reply");
  const firstStarMove=await star.evaluate(()=>{const t=window.__p111StarTest;t.mode("two");return t.moves(0)[0];});
  assert.ok(firstStarMove&&await star.evaluate(m=>window.__p111StarTest.move(m),firstStarMove),"A legal Chinese Checkers opening must be playable");
  assert.equal((await starState()).turn,1,"Chinese Checkers alternates players");
  assert.equal((await starState()).pieces,20,"Chinese Checkers never captures pieces");
  const multi=await star.evaluate(()=>{
   const t=window.__p111StarTest;t.setPieces([["0,0",0],["1,0",0],["3,0",0]]);
   return t.moves(0).find(m=>m.from==="0,0"&&m.to==="4,0");
  });
  assert.equal(multi?.hops,2,"Chinese Checkers must support a two-hop jump over two separate neighbors");
  assert.equal(await star.evaluate(m=>window.__p111StarTest.move(m),multi),true,"Multi-hop Chinese Checkers move executes");
  assert.equal((await starState()).turn,1,"A multi-hop sequence is a single turn");
  await star.evaluate(()=>window.__p111StarTest.undo());
  assert.equal((await starState()).turn,0,"Chinese Checkers undo returns to the previous player");
  assert.ok((await starState()).positions.some(([k,p])=>k==="0,0"&&p===0),"Undo restores the source location");
  await star.close();
  const flight=await browser.newPage({viewport:{width:1150,height:880}});
  flight.on("pageerror",e=>errors.push("FlightChess: "+e.message));
  await flight.goto(pathToFileURL(path.resolve(__dirname,"../app/games/flight-chess/index.html")).href+"?p111Test=1");
  await flight.waitForFunction(()=>!!window.__p111FlightTest);
  assert.equal(await flight.evaluate(()=>window.__p111FlightTest.track()),52,"Flight Chess track contains 52 squares");
  assert.equal(await flight.locator("#diceFace .flight-dice-side svg.flight-dice-svg").count(),6,"Real 3D flight die must have six local SVG faces");
  assert.equal(await flight.locator("#diceFace .flight-dice-side[data-face=\"1\"] .flight-dice-pip").count(),1,"The front face must show one pip");
  assert.equal(await flight.locator("#diceFace").getAttribute("role"),"img","Dice face must expose an image role to assistive technology");
  assert.equal(await flight.locator("#diceFace").getAttribute("aria-label"),"骰子：1点","Dice face must expose an accessible value");
  assert.equal(await flight.locator("#turnText").innerText(),"红方回合","The right turn rail must show the current player");
  // One physical throw = exactly one uninterrupted 500 ms rotation,
  // one visible landing result, then 500 ms of stillness.
  const dieSamples=await flight.evaluate(()=>Array.from({length:600},()=>window.__p111FlightTest.fairDie()));
  assert.deepEqual([...new Set(dieSamples)].sort(),[1,2,3,4,5,6],
   "Secure die must be able to produce every value 1–6");
  // The standalone rule fixture hides the right rail by default. Expose
  // the physical die so Chromium actually paints interpolated 3D frames;
  // geometry of the real GameStation shell is checked by smoke.cjs.
  const diceVisible=await flight.evaluate(()=>{
   const tools=document.querySelector("#game > .game-tools");
   tools.style.setProperty("display","flex","important");
   return document.getElementById("diceFace").getBoundingClientRect().width;
  });
  assert.ok(diceVisible>=60,"3D animation fixture must render a visible die");
  const diceRun=await flight.evaluate(async()=>{
   const api=window.__p111FlightTest;
   api.setPawns([[0,-1,-1,-1],[-1,-1,-1,-1]]);
   const el=document.getElementById("diceFace"),caption=document.getElementById("flightDiceCaption");
   const started=performance.now();
   api.roll();
   const outcome=api.state().roll,log=[];
   for(let i=0;i<35;i++){
    const cube=el.querySelector(".flight-dice-cube");
    log.push({ms:performance.now()-started,phase:el.dataset.phase,
     face:Number(el.dataset.displayFace),caption:caption.textContent,
     transform:getComputedStyle(cube).transform});
    await new Promise(resolve=>setTimeout(resolve,40));
   }
   return{outcome,log,faces:el.querySelectorAll(".flight-dice-side").length,
    final:el.dataset.displayFace,phase:el.dataset.phase,
    state:api.state()};
  });
  assert.equal(diceRun.faces,6,"Flight die retains its six 3D faces");
  const phases=diceRun.log.map(x=>x.phase).filter((x,i,a)=>i===0||x!==a[i-1]);
  assert.deepEqual(phases,["spin","settle","idle"],
   "One throw may only spin continuously, settle once and finish: "+JSON.stringify(phases));
  const settled=diceRun.log.find(x=>x.phase==="settle");
  const idle=diceRun.log.find(x=>x.phase==="idle");
  assert.ok(settled.ms>=460&&settled.ms<=720,
   "Uninterrupted 3D spin should last 500 ms: "+settled.ms);
  assert.ok(idle.ms-settled.ms>=430&&idle.ms-settled.ms<=720,
   "A single 500 ms stationary hold follows landing: "+(idle.ms-settled.ms));
  const spinFrames=diceRun.log.filter(x=>x.phase==="spin");
  assert.ok(new Set(spinFrames.map(x=>x.transform)).size>=5,
   "Cube must visibly rotate throughout its uninterrupted spin");
  assert.ok(spinFrames.every(x=>x.caption==="掷骰中…"),
   "Actual die result must not be announced during spin");
  assert.ok(diceRun.log.filter(x=>x.phase==="settle").every(x=>
   x.face===diceRun.outcome&&x.caption==="点数 "+diceRun.outcome),
   "The stationary half-second shows one final result, not several intermediate results");
  assert.ok(diceRun.log.filter(x=>x.phase==="settle").every(x=>
   x.transform===diceRun.log.find(t=>t.phase==="settle").transform),
   "Die must remain motionless throughout the final hold");
  assert.equal(Number(diceRun.final),diceRun.outcome,"Displayed face must match actual random roll");
  assert.equal(diceRun.state.isRolling,false,"A round ends after the 500+500 ms sequence");
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[-1,-1,-1,-1],[-1,-1,-1,-1]]));
  assert.equal(await flight.locator(".flight-center").count(),0,"Flight Chess must have no second inner board");
  assert.equal(await flight.locator(".reversi-record-rail").count(),1,"Flight Chess must have a left move history");
  const firstPlane=await flight.locator('[data-pawn="0-0"]').evaluate(el=>({x:Number(el.dataset.slotX),y:Number(el.dataset.slotY),cx:Number(el.dataset.centerX),cy:Number(el.dataset.centerY)}));
  assert.equal(firstPlane.x,firstPlane.cx,"A solitary plane must be centered horizontally");
  assert.equal(firstPlane.y,firstPlane.cy,"A solitary plane must be centered vertically");
  // Selecting previews without moving; a green target confirms landing.
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[-1,-1,-1,-1],[-1,-1,-1,-1]]));
  await flight.evaluate(()=>window.__p111FlightTest.roll(6));
  // Standalone rule fixtures intentionally hide the HUD/rails; check the
  // stable document structure here and measure geometry in the shell smoke.
  const stableOrder=await flight.locator("#game > .game-tools").evaluate(tools=>{
   const nodes=[...tools.children],idx=id=>nodes.indexOf(tools.querySelector(id));
   return{help:idx("#flightMoveHelp"),dice:idx(".flight-play-controls"),
    options:idx(".flight-move-panel"),last:idx(".flight-move-panel")===nodes.length-1};
  });
  assert.ok(stableOrder.help>=0&&stableOrder.help<stableOrder.dice&&stableOrder.dice<stableOrder.options&&stableOrder.last,
   "Flight dynamic choices must be last and help text before the dice: "+JSON.stringify(stableOrder));
  const beforePreview=await flight.evaluate(()=>window.__p111FlightTest.state());
  assert.equal(await flight.evaluate(()=>window.__p111FlightTest.preview(0)),true);
  assert.deepEqual((await flight.evaluate(()=>window.__p111FlightTest.state())).pawns,beforePreview.pawns,"Preview does not automatically move the selected airplane");
  assert.ok(await flight.locator(".flight-path-step[data-preview-step]").count()>=1,"Selected airplane renders green numbered path steps");
  assert.equal(await flight.locator(".flight-path-target[data-preview-to]").count(),1,"Flight preview includes a separately clickable landing position");
  assert.equal(await flight.locator("#flightMoveHelp").count(),1,"Flight instructions must have a single stable element");
  const pathStyle=await flight.locator(".flight-path-target").evaluate(el=>{
   const circle=el.querySelector(".flight-target-ring"),trail=document.querySelector(".flight-preview-circle");
   return{circleFill:getComputedStyle(circle).fill,trailFill:getComputedStyle(trail).fill,
    duration:parseFloat(getComputedStyle(el).animationDuration),
    reduced:matchMedia("(prefers-reduced-motion:reduce)").matches};
  });
  assert.ok(pathStyle.circleFill==="rgb(255, 255, 255)"&&pathStyle.trailFill==="rgb(255, 253, 248)",
   "Flight numbered hints and destination must have restored white backgrounds: "+JSON.stringify(pathStyle));
  if(!pathStyle.reduced)assert.ok(pathStyle.duration>=2,"Destination should have slow breathing animation: "+JSON.stringify(pathStyle));

  await flight.locator(".flight-path-target").click();
  assert.equal((await flight.evaluate(()=>window.__p111FlightTest.state())).pawns[0][0],0,"Clicking the green landing circle executes the move");


  // Airport grid is a symmetric 2x2 layout in each 296x296 airport.
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[-1,-1,-1,-1],[-1,-1,-1,-1]]));
  const airportGeometry=await flight.locator("#board").evaluate(svg=>{
   const camps=[{x:66,y:535},{x:535,y:66}],result=[];
   for(let seat=0;seat<2;seat++){
    const points=Array.from({length:4},(_,i)=>{
     const pawn=svg.querySelector('[data-pawn="'+seat+'-'+i+'"]');
     return{x:Number(pawn.dataset.centerX),y:Number(pawn.dataset.centerY)};
    });
    const xs=[...new Set(points.map(p=>p.x))].sort((a,b)=>a-b);
    const ys=[...new Set(points.map(p=>p.y))].sort((a,b)=>a-b);
    result.push({marginsX:[xs[0]-camps[seat].x,xs[1]-xs[0],camps[seat].x+296-xs[1]],
     marginsY:[ys[0]-camps[seat].y,ys[1]-ys[0],camps[seat].y+296-ys[1]],
     unique:new Set(points.map(p=>p.x+","+p.y)).size});
   }
   return result;
  });
  for(const g of airportGeometry){
   assert.equal(g.unique,4,"All four parked planes must occupy separate airport positions");
   assert.ok(Math.max(...g.marginsX)-Math.min(...g.marginsX)<.1&&
    Math.max(...g.marginsY)-Math.min(...g.marginsY)<.1,
    "Each airport must place planes at equal edge/internal spacing: "+JSON.stringify(g));
  }
  // Four planes on one square consolidate into a readable x4 badge.
  // No token may be lost: clicking the pile fans out its four real plane IDs.
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[0,0,0,0],[0,0,0,0]]));
  const stacks=await flight.locator("#board .flight-stack").evaluateAll(els=>els.map(el=>({
   count:Number(el.dataset.stackCount),members:el.dataset.stackMembers.split(","),
   key:el.dataset.stackKey})));
  assert.equal(stacks.length,2,"Two same-color piles should render as two readable group badges");
  assert.ok(stacks.every(g=>g.count===4&&g.members.length===4&&g.key),
   "Each pile must retain all four actual planes, labeled with a count: "+JSON.stringify(stacks));
  assert.equal(await flight.locator(".flight-aircraft").count(),0,
   "Overlapping individual sprites must not obscure pile numbers");
  // Despite the different starting directions, blue progress 26 occupies
  // the same *physical* square as red progress 0. Eight planes become ONE pile.
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[0,0,0,0],[26,26,26,26]]));
  const eight=await flight.locator(".flight-stack").evaluateAll(els=>els.map(el=>({
   count:Number(el.dataset.stackCount),members:el.dataset.stackMembers.split(","),
   half:!!el.querySelector("path")
  })));
  assert.equal(eight.length,1,"Eight aircraft on one physical square must form one merged pile");
  assert.equal(eight[0].count,8,"The pile count must report all eight aircraft");
  assert.equal(eight[0].members.length,8,"No aircraft identity may disappear in an eight-plane pile");
  assert.equal(eight[0].half,true,"An eight-plane mixed-color pile must show both teams");

  // Different colors can occupy a safe square: the pile must show both colors.
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[0,-1,-1,-1],[26,-1,-1,-1]]));
  assert.equal(await flight.locator(".flight-stack[data-stack-count='2'] path").count(),1,
   "A mixed-color pile must visibly split its badge between player colors");
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[0,0,0,0],[-1,-1,-1,-1]]));
  await flight.evaluate(()=>window.__p111FlightTest.roll(6));
  await flight.locator(".flight-stack.can-move").click();
  assert.equal(await flight.locator(".flight-stack-option").count(),4,
   "Clicking a movable four-plane pile must reveal four separated numbered choices");
  await flight.locator('[data-stack-choice="0-2"]').click();
  assert.equal(await flight.locator(".flight-path-target").count(),1,
   "Picking one plane from a pile must preview its independent route");
  await flight.locator(".flight-path-target").click();
  const unstacked=await flight.evaluate(()=>window.__p111FlightTest.state().pawns[0]);
  assert.ok(unstacked[2]>0&&unstacked.filter(p=>p===0).length===3,
   "Only the chosen third plane moves; the other three remain stacked");
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[-1,-1,-1,-1],[-1,-1,-1,-1]]));

  await flight.evaluate(()=>window.__p111FlightTest.pause());
  assert.equal(await flight.locator("#turnText").innerText(),"已暂停","Pause must be reflected in the board center");
  await flight.evaluate(()=>window.__p111FlightTest.resume());
  assert.equal(await flight.locator("#turnText").innerText(),"红方回合","Resume must restore the active player's turn label");
  const flightProfile=await flight.evaluate(()=>["easy","normal","hard"].map(x=>window.__p111FlightTest.profile(x)));
  assert.deepEqual(flightProfile.map(x=>x.risk),[false,false,true],"Hard Flight Chess AI includes future capture risk");
  await flight.evaluate(()=>window.__p111FlightTest.setMode("two"));
  assert.equal(await flight.evaluate(()=>window.__p111FlightTest.roll(2)),true);
  assert.equal(await flight.evaluate(()=>window.__p111FlightTest.moves().length),0,"A plane needs a six to depart");
  assert.equal((await flight.evaluate(()=>window.__p111FlightTest.state())).turn,1,"No legal move passes to the other player");
  const lastRoll=await flight.evaluate(()=>({
   state:window.__p111FlightTest.state(),
   face:document.getElementById("diceFace").dataset.displayFace,
   caption:document.getElementById("flightDiceCaption").textContent
  }));
  assert.equal(lastRoll.state.lastDie,2,"No-move roll must retain its real value, not return to 1");
  assert.equal(lastRoll.face,"2","Visible cube must show the last real value after passing turn");
  assert.equal(lastRoll.caption,"上次 2 点","No legal move should still display the actual last die value");
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[-1,-1,-1,-1],[-1,-1,-1,-1]]));
  await flight.evaluate(()=>window.__p111FlightTest.roll(1));
  assert.equal(await flight.locator("#flightDiceCaption").innerText(),"上次 1 点",
   "A genuine first roll of 1 must remain visible instead of looking like the waiting-state default");
  await flight.evaluate(()=>window.__p111FlightTest.roll(6));
  assert.equal(await flight.evaluate(()=>window.__p111FlightTest.moves().length),4,"Six points unlock four possible planes");
  assert.equal(await flight.locator("#diceFace").getAttribute("aria-label"),"骰子：6点","A six-point roll must update the accessible dice value");
  assert.equal(await flight.locator("#diceFace .flight-dice-side[data-face=\"6\"] .flight-dice-pip").count(),6,"A six-point roll must show six pips on its outward-facing side");
  assert.equal(await flight.locator("#turnText").innerText(),"蓝方 · 6点","The center label must show the active player and rolled value");
  assert.equal(await flight.evaluate(()=>window.__p111FlightTest.move(0)),true);
  const flightState=await flight.evaluate(()=>window.__p111FlightTest.state());
  assert.equal(flightState.pawns[1][0],0,"Six brings an opposing plane onto its start square");
  assert.equal(flightState.turn,1,"Rolling a six grants an extra turn");
  // A same-color landing at progress 8 jumps to 12 and crosses the board to progress 38.
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[7,-1,-1,-1],[-1,-1,-1,-1]]));
  await flight.evaluate(()=>window.__p111FlightTest.roll(1));
  assert.equal(await flight.evaluate(()=>window.__p111FlightTest.move(0)),true);
  assert.equal((await flight.evaluate(()=>window.__p111FlightTest.state())).pawns[0][0],38,
   "Flight shortcut must land on the opposite side, 26 track cells after the entrance");
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[10,-1,-1,-1],[37,-1,-1,-1]]));
  await flight.evaluate(()=>window.__p111FlightTest.roll(1));
  assert.equal(await flight.evaluate(()=>window.__p111FlightTest.move(0)),true);
  const captured=await flight.evaluate(()=>window.__p111FlightTest.state());
  assert.equal(captured.pawns[0][0],11,"Flight Chess moves the plane onto the collision cell");
  assert.equal(captured.pawns[1][0],-1,"Landing on an occupied unsafe square sends the opponent home");
  await flight.evaluate(()=>window.__p111FlightTest.undo());
  assert.equal((await flight.evaluate(()=>window.__p111FlightTest.state())).pawns[1][0],37,"Flight Chess undo restores both own move and captured plane");
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[12,-1,-1,-1],[39,-1,-1,-1]]));
  await flight.evaluate(()=>window.__p111FlightTest.roll(1));
  await flight.evaluate(()=>window.__p111FlightTest.move(0));
  assert.equal((await flight.evaluate(()=>window.__p111FlightTest.state())).pawns[1][0],39,"Flight Chess safe square prevents collision");
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[56,57,57,57],[-1,-1,-1,-1]]));
  await flight.evaluate(()=>window.__p111FlightTest.roll(2));
  assert.equal((await flight.evaluate(()=>window.__p111FlightTest.state())).pawns[0][0],56,"Finishing requires an exact die roll");
  await flight.evaluate(()=>window.__p111FlightTest.setPawns([[56,57,57,57],[-1,-1,-1,-1]]));
  await flight.evaluate(()=>window.__p111FlightTest.roll(1));
  await flight.evaluate(()=>window.__p111FlightTest.move(0));
  assert.equal((await flight.evaluate(()=>window.__p111FlightTest.state())).over,true,"All four planes completing home lane ends the flight game");
  await flight.close();
  const xiangqi=await browser.newPage({viewport:{width:1100,height:850}});
  xiangqi.on("pageerror",err=>errors.push("Xiangqi: "+err.message));
  await xiangqi.goto(pathToFileURL(path.resolve(__dirname,"../app/games/xiangqi/index.html")).href+"?p111Test=1");
  await xiangqi.waitForFunction(()=>typeof window.__p111XiangqiTest?.loadPosition==="function");
  const load=(pieces,side="red")=>xiangqi.evaluate(([p,s])=>window.__p111XiangqiTest.loadPosition(p,s),[pieces,side]);
  const getMoves=(side="red")=>xiangqi.evaluate(s=>window.__p111XiangqiTest.legal(s),side);
  const base=[[4,0,"black","将"],[4,9,"red","帅"],[4,6,"red","兵"]];
  // The horse may not jump over an occupied straight-leg square.
  await load([...base,[4,7,"red","马"]]);
  const h=await getMoves();
  assert.equal(h.some(m=>m.fx===4&&m.fy===7&&m.tx===5&&m.ty===5),false,"horse must not jump over the leg at (4,6)");
  assert.equal(h.some(m=>m.fx===4&&m.fy===7&&m.tx===6&&m.ty===6),true,"unblocked horse jump remains legal");
  // Cannon captures only with exactly one screen.
  await load([...base,[0,7,"red","炮"],[0,5,"red","兵"],[0,2,"black","车"]]);
  const cannon=await getMoves();
  assert.equal(cannon.some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===2),true,"screen permits cannon capture");
  // Execute the capture through exactly one screen, not merely expose a highlighted move.
  await load([...base,[0,7,"red","炮"],[0,5,"red","兵"],[0,2,"black","车"]]);
  await xiangqi.locator('.xiangqi-cell[data-x="0"][data-y="7"]').click();
  await xiangqi.locator('.xiangqi-cell[data-x="0"][data-y="2"]').click();
  assert.match(await xiangqi.locator('.xiangqi-cell[data-x="0"][data-y="2"]').getAttribute("aria-label"),/红炮/,
   "cannon must actually land on and capture the enemy piece beyond one screen");
  assert.match(await xiangqi.locator('.xiangqi-cell[data-x="0"][data-y="7"]').getAttribute("aria-label"),/空位/,
   "cannon source square must become empty after the capture");
  await load([...base,[0,7,"red","炮"],[0,2,"black","车"]]);
  const noScreen=await getMoves();
  assert.equal(noScreen.some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===2),false,"screenless cannon capture must be illegal");
  // Cannon: highlight and click constraints must match exactly-one-screen rules.
  await load([...base,[0,7,"red","炮"],[0,5,"red","兵"],[0,3,"black","卒"],[0,2,"black","车"]]);
  const bounded=await getMoves();
  assert.equal(bounded.some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===3),true,"first enemy beyond one screen capturable");
  assert.equal(bounded.some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===2),false,"second enemy beyond occupied target cannot be captured");
  await xiangqi.locator('.xiangqi-cell[data-x="0"][data-y="7"]').click();
  assert.equal(await xiangqi.locator('.xiangqi-cell[data-x="0"][data-y="3"].target').count(),1,"first legal target highlighted");
  assert.equal(await xiangqi.locator('.xiangqi-cell[data-x="0"][data-y="2"].target').count(),0,"second target never highlighted");
  await xiangqi.locator('.xiangqi-cell[data-x="0"][data-y="2"]').click();
  assert.match(await xiangqi.locator('.xiangqi-cell[data-x="0"][data-y="7"]').getAttribute("aria-label"),/红炮/,"illegal target cannot move cannon");
  await load([...base,[0,7,"red","炮"],[0,5,"red","兵"],[0,2,"red","车"]]);
  assert.equal((await getMoves()).some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===2),false,"friendly piece cannot be captured");
  // Opposing generals on an empty shared file are mutually checking.
  await load([[4,0,"black","将"],[4,9,"red","帅"]]);
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.faces()),true);
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.check("red")),true);
  // Xiangqi no-move position is a loss (困毙), not a western-chess stalemate draw.
  await load([...base,[3,1,"red","车"],[5,1,"red","车"]],"black");
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.check("black")),false);
  assert.equal((await getMoves("black")).length,0);
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.terminal()),true);
  assert.match(await xiangqi.locator("#status").innerText(),/红方获胜.*困毙/);
   assert.equal(await xiangqi.locator("#xiangqiResult").getAttribute("data-result"),"win");
  // Moving the cannon screen away must not leave a second capture available.
  await load([...base,[0,7,"red","炮"],[0,5,"red","兵"],[0,3,"black","卒"],[0,2,"black","车"]]);
  const twoScreens=await xiangqi.evaluate(()=>window.__p111XiangqiTest.pseudo());
  assert.equal(twoScreens.some(m=>m.fx===0&&m.fy===7&&m.tx===0&&m.ty===2),false,
   "cannon may capture only the first enemy piece after exactly one screen");
  // A rook blocks the generals; a sideways move exposes the file and must be rejected,
  // while moving along the same file keeps the blocker in place and remains legal.
  await load([[4,0,"black","将"],[4,9,"red","帅"],[4,5,"red","车"]]);
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.faces()),false);
  const blockerMoves=await getMoves();
  assert.equal(blockerMoves.some(m=>m.fx===4&&m.fy===5&&m.tx===3&&m.ty===5),false,
   "moving the blocker sideways exposes the generals and is illegal");
  assert.equal(blockerMoves.some(m=>m.fx===4&&m.fy===5&&m.tx===4&&m.ty===4),true,
   "moving the blocker along the shared file keeps the generals separated");
  // Xiangqi threefold cycle: the side that continuously checks loses; neutral repetition draws.
  await load([[4,0,"black","将"],[3,9,"red","帅"],[4,2,"red","车"]],"black");
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.check("black")),true);
  await xiangqi.evaluate(()=>window.__p111XiangqiTest.seedRepetition({redChecks:true,blackChecks:false}));
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.terminal()),true);
  assert.match(await xiangqi.locator("#status").innerText(),/红方长将判负/);
  await load([[4,0,"black","将"],[3,9,"red","帅"],[4,2,"red","车"]],"black");
  await xiangqi.evaluate(()=>window.__p111XiangqiTest.seedRepetition({redChecks:false,blackChecks:false}));
  assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.terminal()),true);
  assert.match(await xiangqi.locator("#status").innerText(),/循环局面和棋/);
  // R34: Xiangqi-only 2020 notation, glyph, piece movement, check glow, endgame and AI tests.
   const notation=async(pieces,move,side="red")=>{
    await load(pieces,side);
    return xiangqi.evaluate(([m,s])=>window.__p111XiangqiTest.notation(m,s),[move,side]);
   };
   assert.equal(await notation([...base,[1,7,"red","炮"]],{fx:1,fy:7,tx:4,ty:7}),"炮八平五");
   assert.equal(await notation([...base,[7,2,"black","炮"]],{fx:7,fy:2,tx:4,ty:2},"black"),"炮8平5");
   assert.equal(await notation([...base,[7,9,"red","马"]],{fx:7,fy:9,tx:6,ty:7}),"马二进三");
   assert.equal(await notation([...base,[1,0,"black","马"]],{fx:1,fy:0,tx:2,ty:2},"black"),"马2进3");
   assert.equal(await notation([...base,[0,0,"black","车"]],{fx:0,fy:0,tx:0,ty:2},"black"),"车1进2");
   const sameFile=[...base,[0,9,"red","车"],[0,3,"red","车"]];
   assert.equal(await notation(sameFile,{fx:0,fy:9,tx:0,ty:7}),"后车进二");
   assert.equal(await notation(sameFile,{fx:0,fy:3,tx:0,ty:5}),"前车退二");
   assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.glyph("red","帅")),"帥");
   assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.glyph("black","车")),"車");
   assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.glyph("black","炮")),"砲");
   await load([...base,[2,5,"red","相"]]);
   assert.equal((await getMoves()).some(m=>m.fx===2&&m.fy===5&&m.tx===4&&m.ty===3),false,"elephant may not cross river");
   await load([...base,[2,5,"red","相"],[3,6,"black","卒"]]);
   assert.equal((await getMoves()).some(m=>m.fx===2&&m.fy===5&&m.tx===4&&m.ty===7),false,"occupied eye blocks elephant");
   await load([...base,[4,8,"red","仕"]]);
   assert.equal((await getMoves()).some(m=>m.fx===4&&m.fy===8&&m.tx===5&&m.ty===7),true,"advisor moves on palace diagonals");
   assert.equal((await getMoves()).some(m=>m.fx===4&&m.fy===8&&m.tx===6&&m.ty===6),false,"advisor cannot jump beyond palace");
   await load([...base,[2,5,"red","兵"]]);
   assert.equal((await getMoves()).some(m=>m.fx===2&&m.fy===5&&m.tx===3&&m.ty===5),false,"pawn cannot move sideways before river");
   await load([...base,[2,4,"red","兵"]]);
   assert.equal((await getMoves()).some(m=>m.fx===2&&m.fy===4&&m.tx===3&&m.ty===4),true,"pawn can move sideways after river");
   assert.equal((await getMoves()).some(m=>m.fx===2&&m.fy===4&&m.tx===2&&m.ty===5),false,"pawn cannot retreat");
   await load([[3,0,"black","将"],[4,9,"red","帅"],[4,7,"black","车"]],"red");
   assert.equal(await xiangqi.evaluate(()=>window.__p111XiangqiTest.check("red")),true,"rook checks the general");
   assert.equal(await xiangqi.locator(".xiangqi-cell.checked").count(),1,"checked general must glow");
   assert.equal(await xiangqi.locator(".xiangqi-cell.threatening").count(),1,"attacker must glow");
   assert.match(await xiangqi.locator("#status").innerText(),/红方被将军/);
   // Avoid a false tactical verdict: in the sparse earlier position the black
   // rook can move to the third file with a forcing check, which can be
   // strategically stronger than taking the hanging red rook immediately.
   // Add a central blocker to remove that forcing-check resource and isolate
   // a clean one-move rook capture.
   await load([[4,0,"black","将"],[4,9,"red","帅"],[4,6,"red","兵"],
    [0,3,"black","车"],[0,4,"red","车"]],"black");
   const tactical=await xiangqi.evaluate(()=>({move:window.__p111XiangqiTest.aiChoice("hard"),
    stats:window.__p111XiangqiTest.aiStats()}));
   assert.deepEqual(tactical.move,{fx:0,fy:3,tx:0,ty:4},
    "Hard AI must capture an undefended rook when no forcing mate supersedes the capture");
   assert.ok(tactical.stats.depth>=1,"Hard AI must complete at least one search iteration");
   assert.ok(tactical.stats.elapsed<2400,"AI must respect bounded search budget");
   await xiangqi.evaluate(()=>window.__p111XiangqiTest.forceResult("red","测试获胜"));
   assert.equal(await xiangqi.locator("#xiangqiResultTitle").innerText(),"获胜");
   await xiangqi.evaluate(()=>window.__p111XiangqiTest.forceResult("black","测试失败"));
   assert.equal(await xiangqi.locator("#xiangqiResultTitle").innerText(),"失败");
   assert.equal(await xiangqi.locator("#xiangqiResult").getAttribute("data-result"),"loss");
   await xiangqi.evaluate(()=>window.__p111XiangqiTest.forceResult(null,"双方无胜负"));
   assert.equal(await xiangqi.locator("#xiangqiResultTitle").innerText(),"和棋");
   await xiangqi.close();
   const sg=await browser.newPage({viewport:{width:1100,height:850}});
  sg.on("pageerror",err=>errors.push("Sanguosha: "+err.message));
  await sg.goto(pathToFileURL(path.resolve(__dirname,"../app/games/sanguosha/index.html")).href+"?p111Test=1");
  await sg.waitForFunction(()=>typeof window.__p111SanguoshaTest?.addCard==="function");
  const api=()=>sg.evaluate(()=>window.__p111SanguoshaTest.state());
  const call=(name,...args)=>sg.evaluate(([n,a])=>window.__p111SanguoshaTest[n](...a),[name,args]);
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("setTurn",0);
  await call("addCard",0,"dodge","club");
  assert.equal(await call("canPlay","dodge"),false,"闪 must not be an active-play card");
  await call("setHp",0,3);await call("addCard",0,"peach","heart");
  assert.equal(await call("canPlay","peach"),false,"桃 cannot be wasted at full HP");
  await call("setHp",0,2);
  assert.equal(await call("canPlay","peach"),true,"桃 is legal when wounded");
  // 酒 is once per active turn; it is not consumed as a dying-save quota.
  await call("clearHand",0);await call("addCard",0,"wine","diamond");await call("addCard",0,"wine","club");
  await call("setTurn",0);assert.equal(await call("canPlay","wine"),true);
  await call("play","wine");await sg.waitForTimeout(40);
  assert.equal((await call("flags")).usedWine,true);
  assert.equal(await call("canPlay","wine"),false,"second active 酒 is forbidden in the same turn");
  // 杀 is once per turn and must have a living target.
  await call("clearHand",0);await call("clearHand",1);await call("addCard",0,"kill","spade");await call("addCard",0,"kill","heart");
  await call("setTurn",0);await call("setDifficulty","hard");
  assert.equal(await call("canPlay","kill"),true);
  await call("play","kill",1);await sg.waitForTimeout(50);
  assert.equal((await call("flags")).usedKill,true);
  assert.equal(await call("canPlay","kill"),false,"second 杀 is forbidden in the same turn");
  // A response-only 闪 is consumed only after an explicit incoming response request.
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("addCard",0,"dodge","club");await call("setTurn",0);await call("response",0,"闪",1);
  await sg.locator("#responseBar").waitFor({state:"visible"});
  await sg.locator("#respondYes").click();await sg.waitForTimeout(30);
  assert.equal((await api()).players[0].hand.some(c=>c.type==="dodge"),false,"responded 闪 is discarded");
  // Player may use 酒 to save herself while dying, even after the active-use stage is over.
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("addCard",0,"wine","diamond");await call("setHp",0,3);await call("damage",0,3,-1);
  await sg.locator("#savePanel").waitFor({state:"visible"});
  assert.equal((await api()).pendingSave.target,0);
  await sg.locator("#saveWine").click();await sg.waitForTimeout(30);
  assert.equal((await api()).players[0].hp,1,"dying 酒 restores one HP");
  assert.equal((await api()).players[0].alive,true);
  // 桃 may save another dying character; the rescue window passes through the living seats.
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("addCard",0,"peach","heart");await call("setHp",2,2);await call("damage",2,2,1);
  await sg.locator("#savePanel").waitFor({state:"visible"});
  assert.equal((await api()).pendingSave.target,2);
  await sg.locator("#savePeach").click();await sg.waitForTimeout(30);
  assert.equal((await api()).players[2].hp,1);
  assert.equal((await api()).players[2].alive,true);
  // AI may use 酒 only to save itself when dying.
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("addCard",1,"wine","club");await call("setHp",1,2);await call("damage",1,2,2);
  await sg.waitForTimeout(30);
  assert.equal((await api()).players[1].hp,1,"AI self-rescue with 酒");
  assert.equal((await api()).players[1].alive,true);
  // 小乔's 红颜 turns spades into hearts for 天香; target starts at 3/4 HP, takes 1 damage, then draws 2 cards for 2 lost HP.
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("addCard",0,"kill","spade");await call("setHp",0,3);await call("setHp",2,3);
  const targetHandBefore=(await api()).players[2].hand.length;
  await call("damage",0,1,-1);
  await sg.locator("#tianxiangPanel").waitFor({state:"visible"});
  await sg.locator("#tianxiangCards [data-card]").click();
  await sg.locator('#tianxiangTargets [data-target="2"]').click();await sg.waitForTimeout(40);
  const skillState=await api();
  assert.equal(skillState.players[0].hp,3,"天香 prevents damage to 小乔");
  assert.equal(skillState.players[2].hp,2,"天香 transfers the damage");
  assert.equal(skillState.players[2].hand.length,targetHandBefore+2,"天香 target draws two cards for 4 max HP minus 2 remaining HP");
  // AI difficulty changes decision policy and response resource use, not just delay.
  const sgProfiles=await sg.evaluate(()=>["easy","normal","hard"].map(level=>window.__p111SanguoshaTest.aiProfile(level)));
  assert.deepEqual(sgProfiles.map(x=>x.policy),["随机合法出牌","局面评分与基础攻防","威胁评估与资源管理"]);
  assert.ok(sgProfiles[0].responseBase<sgProfiles[1].responseBase&&sgProfiles[1].responseBase<sgProfiles[2].responseBase,
    "Sanguosha AI difficulty must change response policy");
  // An AI must not read the hidden identities of other seats when choosing a target.
  await call("newGame");await call("setRole",1,"lord");
  assert.equal(await call("aiTarget",1),-1,"The lord AI must not attack an unproven hidden-role opponent");
  await call("setPublicSignals",0,4,5);await call("setPublicSignals",2,0,1);
  const lordTargetBefore=await call("aiTarget",1);
  await call("setRole",0,"spy");await call("setRole",2,"loyalist");await call("setRole",3,"rebel");
  assert.equal(await call("aiTarget",1),lordTargetBefore,"Changing hidden opponent roles cannot change an AI's target");
  assert.equal(lordTargetBefore,0,"The lord AI should prioritize the publicly demonstrated threat");
  // AI chooses only a legal target and uses its own hand; opponents' hidden cards are not inspected.
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("setRole",2,"rebel");await call("setTurn",2);await call("addCard",2,"kill","spade");
  const rebelPlan=await call("aiPlan",2);
  assert.deepEqual(rebelPlan,{type:"kill",target:1},"Rebel AI must direct an available Kill at the publicly known lord");
  // Restore the fixture before the existing card-ID-zero Tianxiang regression.
  await call("newGame");
  // Card ID 0 is valid; Tianxiang must not treat it as absence of a selection.
  for(let i=0;i<4;i++)await call("clearHand",i);
  await call("setHp",0,3);await call("setHp",2,4);await call("addCard",0,"kill","spade",0);
  await call("damage",0,1,-1);
  await sg.locator("#tianxiangPanel").waitFor({state:"visible"});
  await sg.locator('#tianxiangCards [data-card="0"]').click();
  await sg.locator('#tianxiangTargets [data-target="2"]').click();
  assert.equal((await api()).players[2].hp,3,"天香 accepts selected card ID zero and transfers its damage");
  await sg.close();
  const ddz=await browser.newPage({viewport:{width:1100,height:850}});
  ddz.on("pageerror",err=>errors.push("Dou Dizhu: "+err.message));
  await ddz.goto(pathToFileURL(path.resolve(__dirname,"../app/games/doudizhu/index.html")).href);
  await ddz.waitForFunction(()=>!!window.DDZRules);
  const classify=ranks=>ddz.evaluate(rs=>{
   const ids=[],used={};for(const r of rs){const n=used[r]||0;used[r]=n+1;ids.push(r<13?r*4+n:r===13?52:53);}
   return window.DDZRules.classify(ids);
  },ranks);
  const type=async(ranks,name)=>assert.equal((await classify(ranks))?.type,await ddz.evaluate(n=>window.DDZRules.TYPE[n],name),name+" classifier");
  await type([0],"SOLO");await type([0,0],"PAIR");await type([0,0,0],"TRIO");
  await type([0,0,0,1],"TRIO_SOLO");await type([0,0,0,1,1],"TRIO_PAIR");
  await type([0,1,2,3,4],"STRAIGHT");await type([0,0,1,1,2,2],"PAIR_STRAIGHT");
  await type([0,0,0,1,1,1],"PLANE");
  await type([0,0,0,1,1,1,2,3],"PLANE_SOLO");
  await type([0,0,0,1,1,1,2,2,3,3],"PLANE_PAIR");
  await type([0,0,0,0,1,2],"FOUR_SOLO");
  await type([0,0,0,0,1,1,2,2],"FOUR_PAIR");
  await type([3,3,3,3],"BOMB");await type([13,14],"ROCKET");
  assert.equal(await classify([8,9,10,11,12]),null,"2 cannot enter a straight");
  assert.equal(await ddz.evaluate(()=>window.DDZRules.classify([0,0])),null,"same physical card ID cannot be repeated");
  assert.equal(await ddz.evaluate(()=>window.DDZRules.classify([54])),null,"card IDs outside the 54-card deck are invalid");
  const beats=async(a,b)=>ddz.evaluate(([x,y])=>{
   const R=window.DDZRules;const ids=ranks=>{const used={};return ranks.map(r=>{const n=used[r]||0;used[r]=n+1;return r<13?r*4+n:r===13?52:53;});};
   return R.beats(R.classify(ids(x)),R.classify(ids(y)));
  },[a,b]);
  assert.equal(await beats([5],[4]),true);
  assert.equal(await beats([0,0],[5]),false);
  assert.equal(await beats([0,0,0,0],[7,8,9,10,11]),true);
  assert.equal(await beats([1,1,1,1],[0,0,0,0]),true);
  assert.equal(await beats([13,14],[1,1,1,1]),true);
  assert.equal(await beats([1,1,1,1],[13,14]),false);
  await ddz.evaluate(()=>{const R=window.DDZRules;window.__p111DDZGame=R.createGame(20261105);R.deal(window.__p111DDZGame);});
  const readGame=()=>ddz.evaluate(()=>{const g=window.__p111DDZGame;return {phase:g.phase,hands:g.hands.map(h=>h.length),bottom:g.bottom.length,bidTurn:g.bidTurn,landlord:g.landlord,turn:g.turn,lastPlay:g.lastPlay,passCount:g.passCount,multiplier:g.multiplier,over:g.over};});
  let gs=await readGame();
  assert.equal(gs.phase,"bidding");assert.deepEqual(gs.hands,[17,17,17]);assert.equal(gs.bottom,3);
  const deckCount=await ddz.evaluate(()=>{const g=window.__p111DDZGame;return new Set([...g.hands.flat(),...g.bottom]).size;});
  assert.equal(deckCount,54,"all 54 physical cards are dealt once");
  const first=gs.bidTurn,wrong=(first+1)%3;
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.nextBid(window.__p111DDZGame,seat,1),[wrong])).legal,false);
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.nextBid(window.__p111DDZGame,seat,1),[first])).legal,true);
  gs=await readGame();const second=gs.bidTurn;
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.nextBid(window.__p111DDZGame,seat,1),[second])).legal,false);
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.nextBid(window.__p111DDZGame,seat,0),[second])).legal,true);
  gs=await readGame();
  const finalBid=await ddz.evaluate(([seat])=>window.DDZRules.nextBid(window.__p111DDZGame,seat,0),[gs.bidTurn]);
  assert.equal(finalBid.done,true);gs=await readGame();assert.equal(gs.landlord,first);
  assert.equal(await ddz.evaluate(()=>window.DDZRules.startPlay(window.__p111DDZGame)),true);
  gs=await readGame();assert.equal(gs.phase,"playing");assert.equal(gs.turn,first);assert.equal(gs.hands[first],20);
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.pass(window.__p111DDZGame,seat),[first])).legal,false);
  const lead=await ddz.evaluate(seat=>window.__p111DDZGame.hands[seat][0],first);
  assert.equal((await ddz.evaluate(([seat,card])=>window.DDZRules.play(window.__p111DDZGame,seat,[card,card]),[first,lead])).legal,false);
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.play(window.__p111DDZGame,seat,[999]),[first])).legal,false);
  assert.equal((await ddz.evaluate(([seat,card])=>window.DDZRules.play(window.__p111DDZGame,seat,[card]),[first,lead])).legal,true);
  gs=await readGame();const pass1=gs.turn;
  const physicalRemoval=await ddz.evaluate(()=>{
    const R=window.DDZRules,g=R.createGame(77);R.deal(g);g.phase="playing";g.landlord=0;g.turn=0;
    g.hands=[[0,1],[2],[3]];const result=R.play(g,0,[1]);
    return {legal:result.legal,remaining:g.hands[0].slice(),played:g.played.slice()};
  });
  assert.equal(physicalRemoval.legal,true,"a selected physical card can be played");
  assert.deepEqual(physicalRemoval.remaining,[0],"playing card ID 1 must leave card ID 0 in hand");
  assert.deepEqual(physicalRemoval.played,[1],"the played-card history must record the exact ID selected");
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.pass(window.__p111DDZGame,seat),[pass1])).legal,true);
  gs=await readGame();
  assert.equal((await ddz.evaluate(([seat])=>window.DDZRules.pass(window.__p111DDZGame,seat),[gs.turn])).legal,true);
  gs=await readGame();assert.equal(gs.turn,first);assert.equal(gs.lastPlay,null);assert.equal(gs.passCount,0);
  const context=await ddz.evaluate(seat=>window.DDZRules.aiContext(window.__p111DDZGame,seat),(first+1)%3);
  assert.equal(Object.hasOwn(context,"hands"),false,"AI context must not reveal hidden hands");
  assert.equal(Object.hasOwn(context,"hand"),false,"AI context contains no other player's cards");
  const redeal=await ddz.evaluate(()=>{
   const R=window.DDZRules,g=R.createGame(991);R.deal(g);let r;
   for(let i=0;i<3;i++)r=R.nextBid(g,g.bidTurn,0);
   return {result:r,phase:g.phase,landlord:g.landlord};
  });
  assert.equal(redeal.result.redeal,true);assert.equal(redeal.phase,"bidding");assert.equal(redeal.landlord,-1);
  const settlement=await ddz.evaluate(()=>{
   const R=window.DDZRules,g=R.createGame(17);R.deal(g);g.phase="playing";g.landlord=0;g.turn=0;g.highestBid=3;g.multiplier=3;
   g.hands=[[0],[1],[2]];g.lastPlay=null;
   const result=R.play(g,0,[0]);return {result,win:g.landlordWin,multiplier:g.multiplier,scores:R.settle(g)};
  });
  assert.equal(settlement.result.over,true);assert.equal(settlement.win,true);
  assert.equal(settlement.multiplier,6,"spring doubles multiplier");assert.equal(settlement.scores.reduce((a,b)=>a+b,0),0);
  const mj=await browser.newPage({viewport:{width:1100,height:850}});
  mj.on("pageerror",err=>errors.push("Mahjong: "+err.message));
  await mj.goto(pathToFileURL(path.resolve(__dirname,"../app/games/mahjong/index.html")).href+"?p111Test=1");
  await mj.waitForFunction(()=>typeof window.__p111MahjongTest?.loadState==="function");
  const mjCall=(name,...args)=>mj.evaluate(([n,a])=>window.__p111MahjongTest[n](...a),[name,args]);
  const mjState=()=>mj.evaluate(()=>window.__p111MahjongTest.state());
  const standard=[0,1,2,9,10,11,18,19,20,6,7,8,27,27];
  assert.equal(await mjCall("canHu",standard,0),true,"standard four melds plus pair");
  assert.equal(await mjCall("canHu",[0,1,2,9,10,11,18,19,20,27,27],1),true,"one open meld plus three concealed melds and a pair");
  assert.equal(await mjCall("canHu",standard.slice(0,13),0),false,"13 tiles cannot declare Hu");
  const sevenPairs=[0,0,1,1,2,2,9,9,10,10,27,27,28,28];
  assert.equal(await mjCall("canHu",sevenPairs,0),true,"seven pairs enabled");
  assert.equal(await mjCall("canHu",sevenPairs,1),false,"seven pairs not allowed with open melds");
  await mjCall("setRules",{sevenPairs:false});
  assert.equal(await mjCall("canHu",sevenPairs,0),false,"seven-pairs switch disables the pattern");
  await mjCall("setRules",{sevenPairs:true});
  const wall=await mjCall("wall");
  assert.equal(wall.length,136);
  for(let type=0;type<34;type++)assert.equal(wall.filter(x=>x===type).length,4,"four copies of tile "+type);
  const initial=await mjState();
  assert.deepEqual(initial.hands.map(x=>x.length),[14,13,13,13]);
  assert.equal(initial.wall,83);
  // Chi is available only to the next seat, while pong/kong are not seat-restricted.
  await mjCall("loadState",{hands:[[],[3,5],[3,5],[]],pendingSeat:0,pendingType:4,paused:true});
  assert.deepEqual((await mjCall("options",1,4)).chi,[[3,5]]);
  assert.deepEqual((await mjCall("options",2,4)).chi,[]);
  // Claims resolve by Hu > Kong > Pong > Chi, not by seat order alone.
  await mjCall("loadState",{hands:[[],[27,27],[27,27,27],standard.slice(0,13)],pendingSeat:0,pendingType:27,paused:true});
  await mjCall("buildClaims");
  assert.deepEqual((await mjState()).claimQueue.map(q=>[q.seat,q.priority]),[[3,"hu"],[2,"kong"],[1,"pong"]]);
  await mjCall("loadState",{hands:[[2,3,5,6],[],[],[]],pendingSeat:3,pendingType:4});
  assert.deepEqual(await mjCall("options",0,4).then(x=>x.chi),[[2,3],[3,5],[5,6]]);
  // Execute Pong, Chi and exposed Kong; tile counts and turn lifecycle remain consistent.
  await mjCall("loadState",{hands:[[27,27],[],[],[]],wallTypes:[],pendingSeat:3,pendingType:27});
  await mjCall("executeClaim",0,"pong",{});
  let mstate=await mjState();
  assert.equal(mstate.melds[0][0].kind,"pong");assert.deepEqual(mstate.melds[0][0].tiles,[27,27,27]);
  assert.equal(mstate.hands[0].length,0);assert.equal(mstate.current,0);assert.equal(mstate.phase,"discard");
  await mjCall("loadState",{hands:[[2,3,5,6],[],[],[]],pendingSeat:3,pendingType:4});
  await mjCall("executeClaim",0,"chi",{chi:[[5,6]]});
  mstate=await mjState();assert.equal(mstate.melds[0][0].kind,"chi");assert.deepEqual(mstate.melds[0][0].tiles,[4,5,6]);
  assert.deepEqual(mstate.hands[0],[2,3],"selected chi sequence consumes only its own two tiles");
  await mjCall("loadState",{hands:[[27,27,27],[],[],[]],wallTypes:[8],pendingSeat:3,pendingType:27});
  await mjCall("executeClaim",0,"kong",{});
  mstate=await mjState();assert.equal(mstate.melds[0][0].kind,"kong");assert.equal(mstate.hands[0].length,1);assert.equal(mstate.hands[0][0],8);assert.equal(mstate.wall,0);
  // Concealed Kong and added Kong both take a replacement tile.
  await mjCall("loadState",{hands:[[0,0,0,0,1,2,3,4,5,6,7,8,9,10],[],[],[]],wallTypes:[11]});
  assert.ok((await mjCall("kongOptions",0)).some(x=>x.kind==="concealed"&&x.type===0));
  await mjCall("concealedKong",0,0);
  mstate=await mjState();assert.equal(mstate.melds[0][0].kind,"concealed-kong");assert.equal(mstate.melds[0][0].tiles.length,4);
  assert.equal(mstate.hands[0].length,11);assert.equal(mstate.hands[0][10],11);assert.equal(mstate.wall,0);
  await mjCall("loadState",{hands:[[27,0,1,2,3,4,5,6,7,8,9],[],[],[]],melds:[[{kind:"pong",tiles:[27,27,27]}],[],[],[]],wallTypes:[12]});
  assert.ok((await mjCall("kongOptions",0)).some(x=>x.kind==="added"&&x.type===27));
  await mjCall("addedKong",0,27,0);
  mstate=await mjState();assert.equal(mstate.melds[0][0].kind,"added-kong");assert.equal(mstate.melds[0][0].tiles.length,4);
  assert.equal(mstate.hands[0].length,11);assert.equal(mstate.hands[0][10],12);assert.equal(mstate.wall,0);
  // Added Kong may be robbed by an opponent who can Hu with the fourth tile.
  await mjCall("loadState",{hands:[[27,0,1,2,3,4,5,6,7,8,9],standard.slice(0,13),[],[]],
   melds:[[{kind:"pong",tiles:[27,27,27]}],[],[],[]],wallTypes:[12]});
  await mjCall("addedKong",0,27,0);
  mstate=await mjState();assert.equal(mstate.over,true,"rob-kong Hu ends the hand before the replacement draw");
  assert.match(await mj.locator("#tableInfo").innerText(),/抢杠胡/);
  // Empty wall ends in a draw rather than an invalid undefined tile.
  await mjCall("loadState",{hands:[Array.from({length:14},(_,i)=>i),[],[],[]],wallTypes:[],phase:"draw"});
  await mjCall("drawHuman");
  assert.equal((await mjState()).over,true);
  assert.match(await mj.locator("#tableInfo").innerText(),/流局/);
  await mj.close();
  await ddz.close();
  await xiangqi.close();
  assert.deepEqual(errors,[]);
  console.log("P111 rule fixtures passed: Chess; Gomoku; Reversi; Connect Four; Checkers; 2048; Snake; Memory; Sokoban; Sudoku; Pong; Minesweeper; Battleship; Tetris; Klondike; Contra; Mario; Tank; Xiangqi; Chinese Checkers; Flight Chess; Sanguosha; Dou Dizhu; Mahjong.");
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exit(1);});
