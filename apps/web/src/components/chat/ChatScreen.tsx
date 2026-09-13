import React from 'react';
import { ChatLayer } from '../../routes';
import { ChatDoor } from './door';
import { TopicList } from './TopicList';
import { TopicScreen } from './TopicScreen';
import { AskScreen } from './AskScreen';
import { BellScreen } from './BellScreen';

/**
 * The chat module, mounted: one component, whichever context and whichever
 * door (Chat screens README §2). The four layers are addresses; the mounting
 * screen reads the address and hands the layer in, and this decides what is
 * drawn. Nothing here reads the window.
 */
export function ChatScreen({ door, layer, navigate, back, query, insetBottom = 0, onSettings }: {
  door: ChatDoor;
  layer: ChatLayer;
  navigate: (href: string, opts?: { replace?: boolean }) => void;
  back: (fallback: string) => void;
  /** The address's query: `tag` and `private` set the composer, `edit` names the question being changed. */
  query: URLSearchParams;
  insetBottom?: number;
  /** Settings → Notifications, where there is a signed-in person to hold them. */
  onSettings?: () => void;
}) {
  const toList = () => back(door.href.list);
  switch (layer.page) {
    case 'topic':
      return (
        <TopicScreen
          door={door}
          topicId={layer.topicId}
          onBack={toList}
          onEdit={(id) => navigate(`${door.href.ask()}${door.href.ask().includes('?') ? '&' : '?'}edit=${encodeURIComponent(id)}`)}
          shareHref={door.href.topic(layer.topicId)}
          insetBottom={insetBottom}
        />
      );
    case 'ask':
      return (
        <AskScreen
          door={door}
          onBack={toList}
          onPosted={(id) => navigate(door.href.topic(id), { replace: true })}
          initialTag={query.get('tag')}
          initialPrivate={query.get('private') === '1'}
          editTopicId={query.get('edit')}
          insetBottom={insetBottom}
        />
      );
    case 'bell':
      return <BellScreen door={door} onBack={toList} onSettings={onSettings} />;
    default:
      return (
        <TopicList
          door={door}
          onBack={() => back(parentOfList(door.href.list))}
          onOpen={(id) => navigate(door.href.topic(id))}
          onAsk={(opts) => navigate(`${door.href.ask(opts?.tag ?? null)}${opts?.private ? `${door.href.ask(opts?.tag ?? null).includes('?') ? '&' : '?'}private=1` : ''}`)}
          onBell={door.href.bell ? () => navigate(door.href.bell!) : undefined}
          insetBottom={insetBottom}
        />
      );
  }
}

/** One layer up from the list is the thing the conversation belongs to. */
const parentOfList = (list: string) => list.replace(/\/chat(\?.*)?$/, '').replace(/\?.*$/, '') || '/';
