import { parseCfop } from "../core/cfop-parser.ts";
import { CubieCube } from "../utils/mathlib.ts";

// 测试 1：单独的 scramble（cross 应该在前几步完成）
const scramble = ["F", "R", "U", "R'", "U'", "F'"];
const result = parseCfop(scramble);
console.log("Test 1 - 简单 scramble:", scramble);
console.log("Segments:");
for (const seg of result.segments) {
  console.log(`  ${seg.stage}: ${seg.startIdx}-${seg.endIdx} (${seg.moves.length}步) ${seg.moves.join(" ")}`);
}

// 测试 2：scramble 后跟标准 Cross 公式
const scramble2 = ["R", "U", "R'", "F"];
const crossSolve = ["F'", "R", "U'", "R'"];
const full = [...scramble2, ...crossSolve];
const result2 = parseCfop(full);
console.log("\nTest 2 - scramble + cross 还原:", full);
console.log("Segments:");
for (const seg of result2.segments) {
  console.log(`  ${seg.stage}: ${seg.startIdx}-${seg.endIdx} (${seg.moves.length}步) ${seg.moves.join(" ")}`);
}

// 测试 3：SOLVED 状态
const result3 = parseCfop([]);
console.log("\nTest 3 - 空序列:", JSON.stringify(result3));

// 测试 4：单个 R（应该产生 1 个 scramble 段）
const result4 = parseCfop(["R"]);
console.log("\nTest 4 - 单个 R:", result4.segments);