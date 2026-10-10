/**
 * @typedef {Object} Budget
 * @property {number} maxContextChars
 * @property {number} maxReplyChars
 */

/**
 * @typedef {Object} TaskEnvelope
 * @property {string} id
 * @property {string} agent
 * @property {string} objective
 * @property {string[]} contextRefs
 * @property {string[]} allowedPaths
 * @property {string} acceptance
 * @property {string} verification
 * @property {number} deadlineMs
 * @property {Budget} budget
 */

/**
 * @typedef {Object} TaskReceipt
 * @property {string} id
 * @property {string} agent
 * @property {string} state
 * @property {string[]} changedFiles
 * @property {string[]} checks
 * @property {string[]} evidenceRefs
 * @property {string} summary
 * @property {string} uncertainty
 */

export const States = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUBMITTED: 'SUBMITTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN'
};
