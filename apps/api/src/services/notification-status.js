
const transitions = {
  pending: ["queued"],
  queued: ["processing"],
  processing: ["sent", "failed"],
  failed: ["queued"],
  sent: [],
};

export function canTransition(from, to) {
  return transitions[from]?.includes(to) ?? false;
}

export function getAllowedTransitions(status) {
  return transitions[status] ?? [];
}