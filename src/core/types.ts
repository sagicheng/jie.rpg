/**
 * 共享类型 — Mixin 构造器类型（避免各 mixin 文件重复定义）
 */
export type Constructor<T = {}> = new (...args: any[]) => T;
