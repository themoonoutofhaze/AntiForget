import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

interface RichTextMessageProps {
    text: string;
}

const normalizeMathMarkdown = (input: string): string => {
    let normalized = input;

    normalized = normalized.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, math: string) => `\n$$\n${math.trim()}\n$$\n`);

    normalized = normalized.replace(/(^|\n)\[\s*\n([\s\S]*?)\n\]\s*(?=\n|$)/g, (_, prefix: string, math: string) => {
        const candidate = math.trim();
        const looksLikeMath = /\\[a-zA-Z]+|[_^{}=]|\b(sin|cos|tan|log|ln|sum|prod|frac|sqrt|int)\b/.test(candidate);
        if (!looksLikeMath) return `${prefix}[\n${math}\n]`;
        return `${prefix}$$\n${candidate}\n$$`;
    });

    return normalized;
};

export const RichTextMessage: React.FC<RichTextMessageProps> = ({ text }) => {
    const normalizedText = normalizeMathMarkdown(text);

    return (
        <div className="chat-rich">
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
                rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeKatex]}
            >
                {normalizedText}
            </ReactMarkdown>
        </div>
    );
};
