# Como colocar o site na internet

## Onde os dados ficam

O app pode guardar os dados em um PostgreSQL externo ou em um arquivo SQLite local.

- Com `DATABASE_URL`, os grupos ficam no PostgreSQL e o serviço web não precisa de disco persistente.
- Sem `DATABASE_URL`, o app usa `amigo-secreto.db`; a hospedagem precisa montar um **disco persistente** em `/data`, ou os grupos podem sumir quando o serviço reiniciar.

Confira os limites e preços atuais diretamente com cada provedor.

## Render + Neon (PostgreSQL externo)

1. Crie um projeto PostgreSQL no Neon.
2. No painel do Neon, abra **Connect** e copie a connection string. Use a URL fornecida pelo Neon, sem publicar ou enviar essa URL para ninguém.
3. No Render, abra o serviço web e vá em **Environment**.
4. Adicione `DATABASE_URL` com a connection string do Neon como valor secreto.
5. Salve e faça o deploy. O app cria as tabelas necessárias na primeira inicialização; com `DATABASE_URL` configurada, não precisa de disco `/data`.
6. Crie um grupo de teste, reinicie o serviço e confirme que os links continuam funcionando.

**Importante:** definir `DATABASE_URL` não importa os dados que já estavam no arquivo SQLite. Para manter grupos antigos, é preciso migrá-los antes; se o arquivo já foi perdido e não há backup, não há como recuperá-los.

## Outras hospedagens com SQLite local

Render, Railway, Fly.io ou outras hospedagens que aceitem o `Dockerfile` também podem usar SQLite, desde que forneçam um disco/volume persistente montado em `/data`. Defina `DATA_DIR=/data` e `TRUST_PROXY=true`.

O site responde em `/healthz`. Se a hospedagem pedir uma rota de saúde, use essa.

## Servidor próprio (VPS)

Se você tem um servidor Linux com [Docker](https://docs.docker.com/engine/install/):

```bash
git clone <seu-repositorio> amigo-secreto && cd amigo-secreto
docker build -t amigo-secreto .
docker run -d --name amigo-secreto --restart unless-stopped \
  -p 3000:3000 -v amigo-data:/data amigo-secreto
```

O `-v amigo-data:/data` é o disco persistente. Para ter `https://` e um domínio bonito, coloque na frente um servidor como o [Caddy](https://caddyserver.com), que cuida do certificado sozinho.

## Depois de publicar

- **Backup:** faça backup do banco. Com SQLite, copie `/data/amigo-secreto.db`; com Neon, use as opções de backup/exportação do provedor.
- **Atualizar o site:** envie o código novo para o GitHub; a hospedagem faz o deploy. Com PostgreSQL externo ou disco persistente, os grupos continuam após o deploy.
- **HTTPS:** hospedagens prontas já entregam. É necessário para o botão "Copiar link" funcionar em todos os navegadores.
- **Domínio próprio:** opcional; todas as hospedagens permitem apontar um domínio seu.

> O build da imagem Docker não foi executado neste ambiente. Os testes do app e a checagem de tipos foram executados localmente.
