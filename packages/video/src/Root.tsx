import React from 'react';
import { Composition } from 'remotion';
import type { LessonRenderProps } from '@edu/shared';
import { LessonVideo } from './LessonVideo';
import { sampleProps } from './sample';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Lesson"
    component={LessonVideo}
    defaultProps={sampleProps}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={sampleProps.durationInFrames}
    calculateMetadata={({ props }: { props: LessonRenderProps }) => ({
      durationInFrames: props.durationInFrames,
      fps: props.fps,
      width: props.width,
      height: props.height,
    })}
  />
);
