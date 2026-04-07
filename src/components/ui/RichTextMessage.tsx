import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';

const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkBreaks];
const REHYPE_PLUGINS = [rehypeRaw, rehypeKatex];
const MD_COMPONENTS = {
    table: ({ node: _node, ...props }: React.ComponentPropsWithoutRef<'table'> & { node?: unknown }) => (
        <div className="chat-rich-table-wrapper">
            <table {...props} />
        </div>
    ),
};

interface RichTextMessageProps {
    text: string;
}

const normalizeTableMathPipes = (input: string): string => {
    return input
        .split('\n')
        .map((line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('|') || !line.includes('$')) {
                return line;
            }

            return line.replace(/\$([^$\n]+)\$/g, (_match: string, math: string) => {
                const normalizedMath = math.replace(
                    /([A-Za-z0-9)\]}])\|([A-Za-z0-9()])/g,
                    (_innerMatch: string, left: string, right: string) => `${left}\\mid ${right}`,
                );
                return `$${normalizedMath}$`;
            });
        })
        .join('\n');
};

const normalizeMathMarkdown = (input: string): string => {
    let normalized = input;

    normalized = normalized.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, math: string) => `\n$$\n${math.trim()}\n$$\n`);

    normalized = normalized.replace(/\\\(([\s\S]*?)\\\)/g, (_, math: string) => `$${math}$`);

    normalized = normalized.replace(/(^|\n)\[\s*\n([\s\S]*?)\n\]\s*(?=\n|$)/g, (_, prefix: string, math: string) => {
        const candidate = math.trim();
        const looksLikeMath = /\\[a-zA-Z]+|[_^{}=]|\b(sin|cos|tan|log|ln|sum|prod|frac|sqrt|int)\b/.test(candidate);
        if (!looksLikeMath) return `${prefix}[\n${math}\n]`;
        return `${prefix}$$\n${candidate}\n$$`;
    });

    normalized = normalizeTableMathPipes(normalized);

    return normalized;
};

export const RichTextMessage: React.FC<RichTextMessageProps> = ({ text }) => {
    const normalizedText = useMemo(() => normalizeMathMarkdown(text), [text]);

    return (
        <div className="chat-rich">
            <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={MD_COMPONENTS}
            >
                {normalizedText}
            </ReactMarkdown>
        </div>
    );
};
