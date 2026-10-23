// SPDX-License-Identifier: AGPL-3.0-only
// How a card is named, shared by the screens and the data worker. No card number is ever shown.
export const cardName = (card: { bank: string; name: string }) => `${card.bank} ${card.name}`;
