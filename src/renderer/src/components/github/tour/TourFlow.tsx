import type { ReactElement } from 'react';

import type { PullRequestTourFlow, PullRequestTourFlowState, PullRequestTourPoint } from '@shared/pullRequestTour';

import { isAnchoredPoint } from './pullRequestTourWalk';
import { plainTourText } from './tourText';
import { FLOW_NODE_HEIGHT, FLOW_ROW_GAP, layoutTourFlow } from './tourVisuals';

// Half the widest an edge label may be (percent), so a centred label stays inside the panel.
const EDGE_LABEL_HALF = 18;

const STATE_LABELS: Record<PullRequestTourFlowState, string> = {
  changed: 'changed', added: 'new', removed: 'removed', context: 'unchanged'
};

/**
 * A step's flow: how data or control moves through the parts it touches, top to bottom. The outline says what
 * the change did to each part (copper changed, green new, red removed, dashed unchanged). A node that stands
 * for a placed point carries its copper number and selects it; one that names a file opens it.
 */
export function TourFlow({ flow, points, inDiff, activePoint, onSelectPoint, onOpenFile }: {
  flow: PullRequestTourFlow;
  points: readonly PullRequestTourPoint[];
  // Whether a path is in the loaded diff; a tour written before the latest push can name a file that left it.
  inDiff: (path: string) => boolean;
  activePoint: number | null;
  onSelectPoint: (point: number) => void;
  onOpenFile: (path: string) => void;
}): ReactElement {
  const { boxes, lines, height } = layoutTourFlow(flow);
  const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
  const describe = lines
    .map((line) => `${nodes.get(line.from)!.label} to ${nodes.get(line.to)!.label}${line.label ? ` (${line.label})` : ''}`)
    .join('; ');
  return (
    <figure className="pr-tour-flow" style={{ height }} aria-label={`Flow: ${describe}`}>
      <svg className="pr-tour-flow-lines" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {lines.map((line) => {
          const middle = (line.y1 + line.y2) / 2;
          const quarter = FLOW_ROW_GAP / 4;
          const d = line.lane === null
            ? `M ${line.x1} ${line.y1} C ${line.x1} ${middle}, ${line.x2} ${middle}, ${line.x2} ${line.y2 - 4}`
            // Into the lane in the first gap, down it, and out of it in the last gap.
            : `M ${line.x1} ${line.y1} C ${line.x1} ${line.y1 + quarter}, ${line.lane} ${line.y1 + quarter}, ${line.lane} ${line.y1 + 2 * quarter}`
              + ` V ${line.y2 - 2 * quarter} C ${line.lane} ${line.y2 - quarter}, ${line.x2} ${line.y2 - quarter}, ${line.x2} ${line.y2 - 4}`;
          return <path key={`${line.from}>${line.to}`} vectorEffect="non-scaling-stroke" d={d} />;
        })}
      </svg>
      {lines.map((line) => (
        <span key={`${line.from}>${line.to}`} aria-hidden="true">
          <i className="pr-tour-flow-head" style={{ left: `${line.x2}%`, top: line.y2 - 5 }} />
          {line.label ? (
            // A tag on the line at its middle, so labels of a fork or a merge sit on their own branches; a lane's
            // label sits beside the lane halfway down it.
            <span className="pr-tour-flow-edge-label" data-lane={line.lane === null ? undefined : ''}
              style={line.lane === null
                ? { left: `${Math.min(100 - EDGE_LABEL_HALF, Math.max(EDGE_LABEL_HALF, (line.x1 + line.x2) / 2))}%`, top: (line.y1 + line.y2) / 2 - 7 }
                : { left: `${line.lane}%`, top: (line.y1 + line.y2) / 2 - 7, maxWidth: `${100 - line.lane}%` }}>
              {line.label}
            </span>
          ) : null}
        </span>
      ))}
      {boxes.map((box) => {
        const node = nodes.get(box.id)!;
        const point = node.point !== null ? points[node.point] : undefined;
        // A copper number only for a point placed on the diff: it is a real code reference.
        const selects = point !== undefined && isAnchoredPoint(point) && node.point !== null;
        const style = { left: `${box.x}%`, width: `${box.width}%`, top: box.y, height: FLOW_NODE_HEIGHT };
        const content = (
          <>
            {selects ? (
              <span className="pr-guide-marker" data-active={activePoint === node.point || undefined} aria-hidden="true">{node.point! + 1}</span>
            ) : null}
            <span className="pr-tour-flow-label">{node.label}</span>
          </>
        );
        if (node.path === null || (!selects && !inDiff(node.path))) {
          return <span key={box.id} className="pr-tour-flow-node" data-state={node.state} style={style}
            title={`${node.label} (${STATE_LABELS[node.state]})`}>{content}</span>;
        }
        const path = node.path;
        const target = selects ? `point ${node.point! + 1}: ${plainTourText(point.label)}` : path;
        return (
          <button key={box.id} type="button" className="pr-tour-flow-node" data-state={node.state} style={style}
            title={`${node.label} (${STATE_LABELS[node.state]})\n${path}`}
            aria-label={`${node.label}, ${STATE_LABELS[node.state]}. Show ${target}`}
            onClick={() => (selects ? onSelectPoint(node.point!) : onOpenFile(path))}>
            {content}
          </button>
        );
      })}
    </figure>
  );
}
