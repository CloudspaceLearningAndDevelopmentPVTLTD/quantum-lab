"""Generate LinkedIn-ready plain text from posts.md.

posts.md is the canonical copy; this is the paste-in-the-box version of it.
Three things LinkedIn does that markdown files do not:

  1. It renders no markdown. `**bold**` pastes as literal asterisks.
  2. It preserves every newline, so the hard-wrapped prose in posts.md would
     appear as a column of short broken lines. Paragraphs are joined onto one
     line each; blank lines and bullet lines survive.
  3. It suppresses reach on posts carrying an outbound link in the body, so
     every qubit16.ai URL is pulled out and handed to the first comment.

Run:  python src/mk-linkedin.py      (from launch/social)
"""

import io
import os
import re

SRC = 'posts.md'
OUT = 'linkedin'
MOBILE_FOLD = 140  # chars of the first line shown before "see more" on mobile

URL = re.compile(r'(?:^|\s)((?:https?://)?qubit16\.ai[^\s,)]*)')


def unwrap(text: str) -> str:
    """One line per paragraph; bullet lines stay on their own line."""
    out = []
    for para in re.split(r'\n\s*\n', text):
        lines = [l.strip() for l in para.split('\n') if l.strip()]
        if not lines:
            continue
        if any(l.startswith(('·', '-', '—')) for l in lines):
            joined = []
            for l in lines:
                if l.startswith(('·', '-', '—')) or not joined:
                    joined.append(l)
                else:
                    joined[-1] += ' ' + l
            out.append('\n'.join(joined))
        else:
            out.append(' '.join(lines))
    return '\n\n'.join(out)


def strip_markdown(text: str) -> str:
    text = re.sub(r'\*\*(Attach|First comment):\*\*.*\n', '', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'(?<!\*)\*([^*\n]+)\*(?!\*)', r'\1', text)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    text = re.sub(r'^#{1,6} .*$', '', text, flags=re.M)
    return text


def main() -> None:
    src = io.open(SRC, encoding='utf-8').read()
    os.makedirs(OUT, exist_ok=True)
    blocks = re.split(r'\n## Post (\d+) — (.+?)\n', src)[1:]

    for i in range(0, len(blocks), 3):
        num, title, raw = blocks[i], blocks[i + 1], blocks[i + 2].split('\n---\n')[0]
        asset = re.search(r'\*\*Attach:\*\* `assets/(.+?)`', raw)
        artifact = re.search(r'\*\*First comment:\*\* (\S+)', raw)

        body = unwrap(strip_markdown(raw))

        # The shortest qubit16.ai match is the bare site/section link; the long
        # ones are things like the MCP endpoint inside a code line, which is
        # not what belongs in a first comment.
        found = URL.findall(body)
        site = min(found, key=len) if found else None
        body = re.sub(r'\n?[^\n]*(?:Free,[^\n]*|qubit16\.ai/[^\s]*)\n?', '\n', body)
        body = re.sub(r'\n{3,}', '\n\n', body).strip()

        tags = re.search(r'(#[^\n]+)$', body)
        if tags:
            body = (body[:tags.start()].rstrip()
                    + '\n\nLink in the first comment. Free, no account, nothing to install.'
                    + '\n\n' + tags.group(1))

        first = []
        if site:
            first.append(site if site.startswith('http') else 'https://' + site)
        if artifact:
            first.append(artifact.group(1))

        opener = body.split('\n')[0]
        flag = '' if len(opener) <= MOBILE_FOLD else '  <-- OVER THE FOLD, SHORTEN IT'
        head = [
            f'POST {num} — {title}',
            f'ATTACH: assets/{asset.group(1)}' if asset else 'ATTACH: —',
            'FIRST COMMENT: ' + ('  |  '.join(first) if first else '—'),
            f'OPENING LINE: {len(opener)} chars (fold ~{MOBILE_FOLD}){flag}',
            '-' * 60, 'PASTE EVERYTHING BELOW THIS LINE', '-' * 60,
        ]
        path = os.path.join(OUT, f'{int(num):02d}.txt')
        io.open(path, 'w', encoding='utf-8', newline='\r\n').write(
            '\n'.join(head) + '\n\n' + body + '\n')
        print(f'{path}  opener {len(opener)}{flag}')


if __name__ == '__main__':
    main()
