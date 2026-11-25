# 🎄 Amigo Secreto de Natal

Site de amigo secreto leve, rápido e sem cadastro. Funciona bem no celular.

- Quem organiza cria o grupo, manda o **link de convite** e sorteia.
- Cada pessoa recebe um **link secreto** e descobre quem tirou. Nem o organizador vê o resultado.
- Tem **dicas de presente**, **mensagens anônimas** entre quem tirou e quem foi tirado, e **restrições** (ex.: casais não se tiram).

## Rodar no seu computador

1. Instale o [Bun](https://bun.sh) (é o programa que roda o site).
2. Abra a pasta do projeto no VS Code, abra o terminal e rode:

```bash
bun install
bun run dev
```

3. Abra http://localhost:3000 no navegador. Pronto!

Para testar o código: `bun test`.

## O que tem em cada pasta

| Caminho | Para que serve |
|---|---|
| `public/` | O site que a pessoa vê: `index.html`, `style.css` (visual) e `app.js` (telas e botões) |
| `src/server.ts` | Liga o servidor |
| `src/app.ts` | As rotas (criar grupo, entrar, sortear, mensagens...) e as proteções |
| `src/draw.ts` | O sorteio |
| `src/db.ts` | O acesso aos bancos SQLite local e PostgreSQL |
| `src/config.ts` | Configurações |
| `tests/` | Testes automáticos |
| `Dockerfile` | Receita para colocar o site na internet |

## Configurações (opcionais)

Se não definir nada, já funciona. Em hospedagem você pode definir:

| Variável | Padrão | O que faz |
|---|---|---|
| `PORT` | `3000` | Porta do site |
| `DATA_DIR` | `./data` | Pasta do SQLite local, usada quando `DATABASE_URL` não está definida |
| `DATABASE_URL` | — | URL de conexão de um PostgreSQL externo; quando definida, substitui o SQLite |
| `TRUST_PROXY` | `false` | Use `true` na hospedagem, para o limitador de abuso ver o IP real |
| `RETENTION_DAYS` | `0` | Dias até apagar grupos antigos; `0` desativa a limpeza automática |
| `MAX_PARTICIPANTS` | `60` | Máximo de pessoas por grupo |

## Como a privacidade funciona

- Não existe login. Cada link tem um código longo e impossível de adivinhar.
- O **link do organizador** controla o grupo: quem o tiver pode editar ou apagar. Não compartilhe.
- O **link pessoal** de cada participante mostra só quem aquela pessoa tirou.
- O resultado do sorteio fica guardado no banco de dados. Quem administra esse banco tecnicamente pode ler os dados. Para uma turma de amigos e família isso costuma ser aceitável, mas vale saber.
- Por padrão, os grupos não expiram. Se definir `RETENTION_DAYS` como um número maior que zero, grupos mais antigos que esse limite serão apagados automaticamente.

## Colocar na internet

Veja o passo a passo em [HOSPEDAR.md](HOSPEDAR.md).
