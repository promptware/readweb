import type { Newtype } from 'newtype-ts';

export type Html = Newtype<{ readonly Html: unique symbol }, string>;
export type Str = Newtype<{ readonly Str: unique symbol }, string>;

export const asHtml = (value: string): Html => value as unknown as Html;
export const asStr = (value: string): Str => value as unknown as Str;


