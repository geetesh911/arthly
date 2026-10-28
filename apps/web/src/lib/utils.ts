// SPDX-License-Identifier: MIT
import { createCn } from 'cn/config';

// Ink's type sizes from app.css, so a size like `text-small` isn't taken for a colour and dropped
// beside `text-primary-foreground`.
export const cn = createCn({
  extend: {
    classGroups: { 'font-size': [{ text: ['hero', 'headline', 'title', 'body', 'small'] }] },
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
