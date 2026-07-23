# Qodo Code Review Report — v1.0 Release

Este relatório detalha os 10 apontamentos levantados pela revisão automatizada do Qodo (CodiumAI) no Pull Request da versão 1.0. As correções foram divididas em Bugs, Violações de Contrato e Melhorias de Documentação.

---

## 🔴 1. Bugs e Confiabilidade (Alta Criticidade)

### 1.1. Deadlock por "Orphan Lock" (Lock órfão)
- **Local:** `src/shared/lock.ts` (linhas 48-65)
- **O Problema:** A função `withWorkspaceLock()` tenta abrir um arquivo de lock com exclusividade via `openSync("wx")`. Se essa etapa tiver sucesso mas houver uma falha subsequente na escrita dos dados (JSON) ou fechamento, o `catch` atual fecha o descritor mas **não executa o `unlink`** do arquivo. Consequentemente, o lock permanece no sistema vazio ou corrompido, bloqueando permanentemente outras funções do sistema (graph, artifact, workflow) via `LOCK_TIMEOUT`.
- **Ação:** Implementar o bloqueio de falha e garantir o descarte do arquivo lock (`unlinkSync`) num bloco seguro de `catch` apenas caso o descritor tenha sido criado no escopo ativo.

### 1.2. Criação estática de Symlink do tipo "dir"
- **Local:** `scripts/install-lib.mjs` (linhas 151-181, 230-239)
- **O Problema:** A rotina que aplica os atalhos locais usa sempre o tipo de symlink como `"dir"` (diretório). Isso funciona nativamente para as skills do pi, mas na hora de instalar os comandos `.md` do OpenCode, trata-se de **arquivos**. Sistemas operacionais mais estritos (como Windows) falham ao tratar um arquivo usando fallback de link de diretório, e o sistema de rollback do agente quebra na hora de validar remoções.
- **Ação:** Mapear programaticamente via `lstatSync` ou inferência para gerar symlinks do tipo `"file"` ou `"dir"`.

---

## 🟠 2. Violações de Contrato e Tipagem (Média Criticidade)

### 2.1. Propriedade `nextAction` opcional na tipagem do Workflow
- **Local:** `src/workflow/types.ts` (linhas 29-38)
- **O Problema:** O checklist de regras impõe que itens do Workflow carreguem imperativamente o que precisa ser feito (`nextAction`), porém o tipo de `WorkflowItemV1` declara `nextAction?: string`.
- **Ação:** Tornar o campo `nextAction` obrigatório (`string`) sem a marcação opcional.

### 2.2. Diretório Referenciado Inexistente (`docs/wiki/`)
- **Local:** `AGENTS.md`, `README.md`, `docs/smoke-tests.md`
- **O Problema:** Os documentos direcionam o agente/leitor a começar a navegação pelo arquivo `docs/wiki/index.md`. Como a estrutura do repositório ignora a wiki ou a torna gerada dinamicamente, essa pasta não existe, falhando o teste automatizado de navegação de recursos.
- **Ação:** Adicionar as instruções de que a wiki deve ser *gerada* previamente, ou instanciar um artefato OKF (Open Knowledge Format) mínimo em `docs/wiki/index.md`.

### 2.3. Categorias de "Findings" Inválidas
- **Local:** `skills/codepatrol-review/REVIEW-FORMAT.md` (linha 20)
- **O Problema:** O formato markdown dá ao revisor categorias alternativas como `<contract|architecture|plan|evidence>`. O contrato oficial do parser interno apenas aceita `<contract|code|simplicity|verification|artifact-drift>`.
- **Ação:** Corrigir os placeholders no `REVIEW-FORMAT.md` para as opções da lista predefinida (enumerated set).

### 2.4. Veredito `approve` classificado como Violação
- **Local:** `REVIEW-FORMAT.md` e `review-check.ts`
- **O Problema:** O Qodo listou como "Violação" o uso do veredito `approve`, citando que as regras ativas exigiam que as respostas fossem restritas apenas a `merge`, `fix-first` ou `rework`.
- **Ação:** *(Tratar como Falso Positivo/Regra Externa)*. A substituição do vocabulário `merge` por `approve` era especificamente a função desta release, suportada pelo novo ADR 0001. A regra na plataforma Qodo precisará ser atualizada externamente pelo administrador.

---

## 🟡 3. Boas Práticas e Risco de Manutenção (Baixa Criticidade)

### 3.1. Links do Github não-fixados (Unpinned URLs)
- **Local:** `skills/diagnose-bug/SKILL.md`, `skills/domain-modeling/SKILL.md`, `skills/grilling/SKILL.md`
- **O Problema:** URLs apontando para projetos de inspiração externa (ex: repositórios de refactoring ou habilidades) usam a URL crua do repositório. As regras de isolamento do *Codepatrol* impedem ancoragem flutuante, exigindo um hash de commit exato para evitar que a documentação perca o sentido se os repositórios fonte mudarem no futuro.
- **Ação:** Anexar o sufixo de revisão estática (`/tree/<hash>`) aos repositórios.

### 3.2. Dependência Externa Curinga
- **Local:** `package.json` (linhas 58-60)
- **O Problema:** A biblioteca `@earendil-works/pi-coding-agent` está listada em `peerDependencies` com a versão curinga `*`. Versões abertas aumentam vulnerabilidade e afetam a reprodutibilidade.
- **Ação:** Fixar ou restringir a versão (ex: `^1.0.0`).

---

## 🟢 4. Estilo de Documentação e Glossário (Insights)

### 4.1. Definição do Glossário muito longa e com contexto de implementação
- **Local:** `CONTEXT.md` (termo: *Distribution Adapter*)
- **O Problema:** A definição mistura o conceito lógico do glossário com detalhes físicos do repositório (mencionando `scripts/install-local.mjs` e as pastas `.pi/` etc). Além de violar o tamanho máximo (2 frases), quebra a pureza conceitual.
- **Ação:** Remover caminhos em disco e focar apenas no propósito funcional.

### 4.2. Ausência da anotação de restrição (`_Avoid_`)
- **Local:** `CONTEXT.md` (termos: *Fix-first* e *Rework*)
- **O Problema:** Por regra, todas as definições devem declarar termos correlatos e desencorajar o uso deles usando a anotação `_Avoid_: ...`. Faltou a anotação nesses novos itens.
- **Ação:** Adicionar palavras similares que devem ser evitadas, como `Reject`, `Changes-requested`, etc.
