"""Convert a Google Docs API JSON export of the 逐字稿對照版 into practice/data.json.

Usage: python3 -I practice/tools/doc_to_data.py <read_doc.json> <out data.json>

The doc layout is one 2-column table per slide: the left cell holds
"第 N 頁｜m:ss–m:ss｜講者：…" (plus the slide picture), the right cell the
title line "N｜標題" and the spoken paragraphs. After the tables comes
"綜合座談備答" with "Qn｜問題" paragraphs followed by their answers.
"""
import json
import re
import sys


def para_text(paragraph: dict) -> str:
    return ''.join(run.get('textRun', {}).get('content', '') for run in paragraph['paragraph']['elements'])


def cell_text(cell: dict) -> str:
    return ''.join(para_text(p) for p in cell['content'] if 'paragraph' in p)


def to_seconds(clock: str) -> int:
    minutes, seconds = clock.split(':')
    return int(minutes) * 60 + int(seconds)


def convert(doc: dict) -> dict:
    content = doc.get('content', doc)
    body = content['tabs'][0]['documentTab']['body']['content']
    pages, qa = [], []
    in_qa, current = False, None
    for element in body:
        if 'table' in element:
            left, right = element['table']['tableRows'][0]['tableCells'][:2]
            header = cell_text(left).replace('\n', ' ').strip()
            match = re.search(r'第 (\d+) 頁｜(\d+:\d\d)–(\d+:\d\d)｜', header)
            if not match:
                raise ValueError(f'無法辨識頁首：{header!r}')
            lines = [line.strip() for line in cell_text(right).replace('\x0b', '\n').split('\n')]
            lines = [line for line in lines if line]
            title = re.sub(r'^\d+｜', '', lines[0])
            paragraphs = lines[1:]
            marker = paragraphs.pop(0) if paragraphs and paragraphs[0].startswith('【') else None
            n = int(match.group(1))
            ciping = n <= 7
            pages.append({
                'n': n, 'title': title,
                'start': to_seconds(match.group(2)), 'end': to_seconds(match.group(3)),
                'speaker': 'ciping' if ciping else 'yiyun',
                'speakerLabel': 'Ciping 慧麗' if ciping else '奕芸',
                'marker': marker, 'paragraphs': paragraphs,
            })
        elif 'paragraph' in element:
            text = para_text(element).strip()
            if text == '綜合座談備答':
                in_qa = True
                continue
            if not in_qa or not text:
                continue
            question = re.match(r'(Q\d+)｜(.*)', text)
            if question:
                current = {'id': question.group(1), 'q': question.group(2), 'a': []}
                qa.append(current)
            elif current:
                current['a'].append(text)
    return {
        'title': 'Dateng 野菜探險家－餐桌上的永續智慧',
        'source': '02_演講逐字稿_Dateng野菜探險家_20261107（Google 文件快照）',
        'revision': content['revisionId'][:12],
        'pages': pages,
        'qa': qa,
    }


if __name__ == '__main__':
    source, target = sys.argv[1], sys.argv[2]
    with open(source, encoding='utf-8') as handle:
        data = convert(json.load(handle))
    with open(target, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=1)
    print(f"{len(data['pages'])} pages, {len(data['qa'])} Q&A, ends at {data['pages'][-1]['end']}s, rev {data['revision']}")
