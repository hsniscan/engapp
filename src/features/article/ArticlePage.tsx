// /makale — "Bağlantıdan makale" (v0.5 İP2, decision 0044): paste an address, get the
// article's text, open it in the reader or extract its words. ?url= starts at once.
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { ImportGate } from '@/features/import/ImportGate';
import { Button, Page, TextField } from '@/ui';
import { ArticleFetch } from './ArticleFetch';
import { normaliseArticleUrl } from './useArticle';

export function ArticlePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const current = params.get('url');
  const [input, setInput] = useState(current ?? '');
  const [invalid, setInvalid] = useState(false);
  const formId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = normaliseArticleUrl(input);
    setInvalid(!url);
    if (url) setParams({ url }, { replace: !!current });
  };

  const url = current ? normaliseArticleUrl(current) : null;
  return (
    <Page title={t('article.pageTitle')} description={t('article.pageLead')}>
      <form id={formId} onSubmit={submit} className="mb-6 flex flex-col gap-3" noValidate>
        <TextField
          label={t('article.urlLabel')}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={t('article.urlPlaceholder')}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setInvalid(false);
          }}
          error={invalid ? t('article.urlInvalid') : undefined}
          leadingIcon="link"
          data-testid="article-url"
        />
        <div>
          <Button type="submit" size="lg" leadingIcon="arrow-right" data-testid="article-submit">
            {t('article.fetch')}
          </Button>
        </div>
        <p className="text-sm text-fg-muted">{t('article.privacy')}</p>
      </form>
      {url && (
        <ImportGate>
          <ArticleFetch key={url} url={url} />
        </ImportGate>
      )}
    </Page>
  );
}
