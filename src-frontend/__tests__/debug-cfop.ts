// 调试 cfop-parser 的多个场景
import { parseCfop } from "../core/cfop-parser.ts";

// 测试 1：单独 scramble
const scramble = ["F", "R", "U", "R'", "U'", "F'"];
console.log("Test 1 - 简单 scramble:", scramble);
console.log("Segments:");
for (const seg of parseCfop(scramble).segments) {
  console.log(`  ${seg.stage}: ${seg.startIdx}-${seg.endIdx} (${seg.moves.length}步) ${seg.moves.join(" ")}`);
}

// 测试 2：scramble + cross 还原
const full = ["R", "U", "R'", "F", "F'", "R", "U'", "R'"];
console.log("\nTest 2 - scramble + cross 还原:", full);
console.log("Segments:");
for (const seg of parseCfop(full).segments) {
  console.log(`  ${seg.stage}: ${seg.startIdx}-${seg.endIdx} (${seg.moves.length}步) ${seg.moves.join(" ")}`);
}

// 测试 3：空序列
console.log("\nTest 3 - 空序列:", JSON.stringify(parseCfop([])));

// 测试 4：单个 R
console.log("\nTest 4 - 单个 R:", parseCfop(["R"]).segments);

// 测试 5：4 次 U 应该回到 SOLVED
const r4 = ["U", "U", "U", "U"];
console.log("\nTest 5 - 4 次 U（幂等）:", parseCfop(r4).segments);

// 测试 6：综合 case（10 步 scramble + 标准 Sune + reverse）
const sune = ["R", "U", "R'", "U", "R", "U2", "R'"];
const rev = sune.slice().reverse().map((m) =>
  m.includes("'") ? m[0] :
  m.includes("2") ? m[0] + "2" :
  m[0] + "'"
);
const full2 = [...sune, ...rev];
console.log("\nTest 6 - Sune + reverse(Sune):", full2);
const res = parseCfop(full2);
console.log("Segments:");
for (const seg of res.segments) {
  console.log(`  ${seg.stage}: ${seg.startIdx}-${seg.endIdx} (${seg.moves.length}步) ${seg.moves.join(" ")}`);
}
console.log("isSolved:", res.isSolved);