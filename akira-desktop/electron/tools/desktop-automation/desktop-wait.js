/**
 * Desktop Wait Tool
 * desktop_wait - Wait/sleep for a specified duration (0-30 seconds)
 */

const definitions = [
  {
    name: 'desktop_wait',
    description: 'Wait/sleep for a specified duration (0-30 seconds). Use between UI actions.',
    input_schema: {
      type: 'object',
      properties: {
        seconds: {
          type: 'number',
          description: 'Duration to wait (0-30 seconds)',
        },
      },
      required: ['seconds'],
    },
  },
];

const handlers = {
  async desktop_wait(input) {
    const seconds = input.seconds;

    if (seconds == null || seconds < 0 || seconds > 30) {
      return { success: false, error: 'seconds must be between 0 and 30' };
    }

    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    return { waited_seconds: seconds };
  },
};

module.exports = { definitions, handlers };
