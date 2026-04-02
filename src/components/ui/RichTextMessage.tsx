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

export const RichTextMessage: React.FC<RichTextMessageProps> = ({ text }) => {
    return (
        <div className="chat-rich">
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
                rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeKatex]}
            >
                {text}
            </ReactMarkdown>
        </div>
    );
};
