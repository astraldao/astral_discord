export class SerialQueue {
  tail = Promise.resolve();
  size = 0;
  add(task) {
    this.size++;
    const result = this.tail.then(task);
    this.tail = result.catch(() => {}).finally(() => { this.size--; });
    return result;
  }
}

export function canEnter(channel, member, bot, lobbyId, targets) {
  const listed=Array.isArray(targets) ? targets.includes(channel?.id) : channel?.parentId === targets;
  if (!channel || channel.type !== 2 || channel.id === lobbyId || !listed) return false;
  const memberPermissions = channel.permissionsFor(member);
  const botPermissions = channel.permissionsFor(bot);
  // Admin-listed destinations authorize bot-assisted entry without member Connect.
  // Retain member ViewChannel and the bot's ViewChannel/Connect/MoveMembers/chat permissions.
  const has = (permissions, bits) => permissions?.has(bits) === true;
  return has(memberPermissions, [1024n])
    && has(botPermissions, [1024n, 1048576n, 16777216n, 2048n, 16384n])
    && (!channel.userLimit || channel.members.filter(m => !m.user.bot).size < channel.userLimit);
}
