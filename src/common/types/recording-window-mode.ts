// How the game window behaves while recording videos.
export const RecordingWindowMode = {
  // The game window is displayed and focused like when watching a demo.
  Normal: 'normal',
  // @platform win32 The game window is sent behind the other windows and the focus is given back to the previous window.
  Background: 'background',
  // @platform win32 Same as background but the game window is also moved outside of the screens.
  OffScreen: 'off-screen',
} as const;

export type RecordingWindowMode = (typeof RecordingWindowMode)[keyof typeof RecordingWindowMode];

export function isValidRecordingWindowMode(value: string): value is RecordingWindowMode {
  return Object.values(RecordingWindowMode).includes(value as RecordingWindowMode);
}
