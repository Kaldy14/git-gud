import type { ReactElement } from 'react';

import type { ExternalApplication } from '@shared/externalApplications';

export function ApplicationIcon({
  application,
  size
}: {
  application: ExternalApplication;
  size: number;
}): ReactElement {
  return (
    <img
      src={application.iconDataUrl}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-[4px]"
      draggable={false}
    />
  );
}
