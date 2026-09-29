import type { LessonRenderProps } from '@edu/shared';

/**
 * Props mẫu để mở Remotion Studio khi chưa có dữ liệu thật (không cần ảnh/âm thanh).
 * Muốn xem bài thật: lấy props.json trong thư mục render của bài học và dán vào Studio.
 */
export const sampleProps: LessonRenderProps = {
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 300,
  burnSubtitles: true,
  characters: {},
  intro: {
    durationInFrames: 120,
    title: 'Số 0',
    subtitle: 'Toán · Lớp 1',
    hostId: null,
    audioSrc: null,
    mouth: '',
    level: '',
  },
  scenes: [
    {
      from: 104,
      durationInFrames: 106,
      transition: 'iris',
      background: { src: '', width: 1920, height: 1080 },
      characters: [],
      shots: [
        {
          from: 0,
          durationInFrames: 106,
          speaker: 'narrator',
          text: 'Cái giỏ này không có quả nào cả.',
          audioSrc: null,
          audioOffset: 15,
          audioFrames: 60,
          mouth: '',
          level: '',
          framing: 'object',
          targetBox: [0.4, 0.4, 0.6, 0.6],
          transition: 'cut',
          motion: 'push-in',
          action: 'talk',
          reaction: 'none',
          listener: null,
          overlay: { kind: 'label', text: '0', boxes: [[0.4, 0.4, 0.6, 0.6]], startFrames: [20] },
        },
      ],
    },
  ],
  outro: {
    from: 194,
    durationInFrames: 106,
    heading: 'Ghi nhớ',
    points: ['Không có đồ vật nào thì ta dùng số 0.'],
    hostId: null,
  },
  music: null,
  sfx: [],
  voiceIntervals: [],
};
