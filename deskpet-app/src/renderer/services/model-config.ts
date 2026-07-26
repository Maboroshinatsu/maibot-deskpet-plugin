/**
 * 模型配置
 *
 * MODEL_PATH 只是「首次启动的默认模型」。
 * 用户在设置面板里选过模型之后，优先级更高的是 localStorage 里的
 * deskpet/model-path（见 services/live2d/model-discovery.ts）。
 *
 * 想换内置默认模型：把 Live2D 模型文件夹放进 src/renderer/public/models/，
 * 再把 MODEL_PATH 指向对应的 .model3.json。
 */
export const MODEL_PATH = './models/hiyori_pro_zh/hiyori_pro_zh/runtime/hiyori_pro_t11.model3.json'
