/** Jest 配置：仅用于 QA 的单元测试（本仓库工程师不写测试文件）。
 *  使用 ts-jest 在 node 环境下运行 test/ 下的 *.test.ts。 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  // 纯逻辑模块（ConfigStore / PromptTemplates）在 node 下可独立类型自检；
  // 涉及 electron 的模块由 QA 自行 mock。
  collectCoverageFrom: ['src/**/*.ts'],
  // 测试使用独立的 tsconfig（tsconfig.test.json）：在 node 类型基础上加入 jest 全局类型
  // （describe/test/expect），避免主 tsconfig 的 types:["node"] 导致编译报错。
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};
