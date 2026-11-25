# 🎄 Amigo Secreto de Natal

Site de amigo secreto leve, rápido e sem cadastro. Funciona bem no celular.

- Quem organiza cria o grupo, manda o **link de convite** e sorteia.
- Cada pessoa recebe um **link secreto** e descobre quem tirou. Nem o organizador vê o resultado.
- Tem **dicas de presente**, **mensagens anônimas** entre quem tirou e quem foi tirado, e **restrições** (ex.: casais não se tiram).

## Rodar no seu computador

1. Instale o [Bun](https://bun.sh) (é o programa que roda o site).
2. Abra a pasta do projeto no VS Code, abra o terminal e rode:

```bash
bun run dev
```

3. Abra http://localhost:3000 no navegador. Pronto!

Não precisa de `bun install` para rodar. Se quiser as dicas automáticas do VS Code para TypeScript, rode `bun install` uma vez.

Para testar o código: `bun test`.

## O que tem em cada pasta

| Caminho | Para que serve |
|---|---|
| `public/` | O site que a pessoa vê: `index.html`, `style.css` (visual) e `app.js` (telas e botões) |
| `src/server.ts` | Liga o servidor |
| `src/app.ts` | As rotas (criar grupo, entrar, sortear, mensagens...) e as proteções |
| `src/draw.ts` | O sorteio |
| `src/db.ts` | O banco de dados (SQLite, um único arquivo em `data/`) |
| `src/config.ts` | Configurações |
| `tests/` | Testes automáticos |
| `Dockerfile` | Receita para colocar o site na internet |

## Configurações (opcionais)

Se não definir nada, já funciona. Em hospedagem você pode definir:

| Variável | Padrão | O que faz |
|---|---|---|
| `PORT` | `3000` | Porta do site |
| `DATA_DIR` | `./data` | Pasta do banco de dados |
| `TRUST_PROXY` | `false` | Use `true` na hospedagem, para o limitador de abuso ver o IP real |
| `RETENTION_DAYS` | `180` | Grupos mais velhos que isso são apagados sozinhos |
| `MAX_PARTICIPANTS` | `60` | Máximo de pessoas por grupo |

## Como a privacidade funciona

- Não existe login. Cada link tem um código longo e impossível de adivinhar.
- O **link do organizador** controla o grupo: quem o tiver pode editar ou apagar. Não compartilhe.
- O **link pessoal** de cada participante mostra só quem aquela pessoa tirou.
- O resultado do sorteio fica guardado no banco de dados, no servidor. Quem administra o servidor (você, se hospedar) tecnicamente consegue ler o arquivo. Para uma turma de amigos e família isso costuma ser aceitável, mas vale saber.
- Os grupos são apagados sozinhos depois de `RETENTION_DAYS` dias.

## Colocar na internet

Veja o passo a passo em [HOSPEDAR.md](HOSPEDAR.md).
