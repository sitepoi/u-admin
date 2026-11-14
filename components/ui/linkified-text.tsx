import { Fragment } from 'react';

const URL_SPLIT_PATTERN = /(https?:\/\/[^\s]+)/g;

/**
 * Renders plain text with any URL as a clickable link. Used for Firestore
 * index errors, whose console links are long and impossible to copy by hand.
 */
export function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_SPLIT_PATTERN);

  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('http') ? (
          <a
            key={`${part}-${index}`}
            href={part}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all text-indigo-700 underline hover:text-indigo-600"
          >
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
