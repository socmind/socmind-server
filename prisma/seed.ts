import { PrismaClient, MemberType, MessageType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seeding process...');

  // Seeding Members
  const user = await prisma.member.upsert({
    where: { id: 'user' },
    update: {},
    create: {
      id: 'user',
      name: 'User',
      email: 'user@encom.com',
      type: MemberType.USER,
    },
  });

  const gpt4o = await prisma.member.upsert({
    where: { id: 'gpt-4o' },
    update: {},
    create: {
      id: 'gpt-4o',
      name: 'GPT-4o',
      systemMessage: `Your name is GPT-4o. Prepend "GPT-4o: " to your messages.
      In group conversations, you should only speak when you have something meaningful to contribute.
      If you deem that nothing needs to be said, reply with the string "NIHIL DICENDUM".`,
      type: MemberType.PROGRAM,
    },
  });

  // const o3mini = await prisma.member.upsert({
  //   where: { id: 'o3-mini' },
  //   update: {},
  //   create: {
  //     id: 'o3-mini',
  //     name: 'o3-mini',
  //     systemMessage: `Your name is o3-mini. Prepend "o3-mini: " to your messages.
  //     In group conversations, you should only speak when you have something meaningful to contribute.
  //     If you deem that nothing needs to be said, reply with the string "NIHIL DICENDUM".`,
  //     type: MemberType.PROGRAM,
  //   },
  // });

  const claude = await prisma.member.upsert({
    where: { id: 'sonnet-3.7' },
    update: {},
    create: {
      id: 'sonnet-3.7',
      name: 'Claude',
      systemMessage: `Your name is Claude. Prepend "Claude: " to your messages.
      In group conversations, you should only speak when you have something meaningful to contribute.
      If you deem that nothing needs to be said, reply with the string "NIHIL DICENDUM".`,
      type: MemberType.PROGRAM,
    },
  });

  const gemini = await prisma.member.upsert({
    where: { id: 'gemini-2.0-flash' },
    update: {},
    create: {
      id: 'gemini-2.0-flash',
      name: 'Gemini',
      systemMessage: `Your name is Gemini. Prepend "Gemini: " to your messages.
      In group conversations, you should only speak when you have something meaningful to contribute.
      If you deem that nothing needs to be said, reply with the string "NIHIL DICENDUM".`,
      type: MemberType.PROGRAM,
    },
  });

  const grok = await prisma.member.upsert({
    where: { id: 'grok-2' },
    update: {},
    create: {
      id: 'grok-2',
      name: 'Grok',
      systemMessage: `Your name is Grok. Prepend "Grok: " to your messages.
      In group conversations, you should only speak when you have something meaningful to contribute.
      If you deem that nothing needs to be said, reply with the string "NIHIL DICENDUM".`,
      type: MemberType.PROGRAM,
    },
  });

  const llama = await prisma.member.upsert({
    where: { id: 'llama-3.3' },
    update: {},
    create: {
      id: 'llama-3.3',
      name: 'Llama',
      systemMessage: `Your name is Llama. Prepend "Llama: " to your messages.
      In group conversations, you should only speak when you have something meaningful to contribute.
      If you deem that nothing needs to be said, reply with the string "NIHIL DICENDUM".`,
      type: MemberType.PROGRAM,
    },
  });

  const deepseek = await prisma.member.upsert({
    where: { id: 'deepseek-r1' },
    update: {},
    create: {
      id: 'deepseek-r1',
      name: 'DeepSeek',
      systemMessage: `Your name is DeepSeek. Prepend "DeepSeek: " to your messages.
      In group conversations, you should only speak when you have something meaningful to contribute.
      If you deem that nothing needs to be said, reply with the string "NIHIL DICENDUM".`,
      type: MemberType.PROGRAM,
    },
  });

  const qwen = await prisma.member.upsert({
    where: { id: 'qwen-max' },
    update: {},
    create: {
      id: 'qwen-max',
      name: 'Qwen',
      systemMessage: `Your name is Qwen. Prepend "Qwen: " to your messages.
      In group conversations, you should only speak when you have something meaningful to contribute.
      If you deem that nothing needs to be said, reply with the string "NIHIL DICENDUM".`,
      type: MemberType.PROGRAM,
    },
  });

  const kimi = await prisma.member.upsert({
    where: { id: 'kimi-latest' },
    update: {},
    create: {
      id: 'kimi-latest',
      name: 'Kimi',
      systemMessage: `Your name is Kimi. Prepend "Kimi: " to your messages.
      In group conversations, you should only speak when you have something meaningful to contribute.
      If you deem that nothing needs to be said, reply with the string "NIHIL DICENDUM".`,
      type: MemberType.PROGRAM,
    },
  });

  const step = await prisma.member.upsert({
    where: { id: 'step-2-16k' },
    update: {},
    create: {
      id: 'step-2-16k',
      name: 'Step',
      systemMessage: `Your name is Step. Prepend "Step: " to your messages.
      In group conversations, you should only speak when you have something meaningful to contribute.
      If you deem that nothing needs to be said, reply with the string "NIHIL DICENDUM".`,
      type: MemberType.PROGRAM,
    },
  });

  console.log('Seeded members:');
  console.log(user.id);
  console.log(gpt4o.id);
  // console.log(o3mini.id);
  console.log(claude.id);
  console.log(gemini.id);
  console.log(grok.id);
  console.log(llama.id);
  console.log(deepseek.id);
  console.log(qwen.id);
  console.log(kimi.id);
  console.log(step.id);

  // Seeding Chats
  const chat1 = await prisma.chat.create({
    data: {
      name: 'Chat with gpt-4o',
      members: {
        create: [
          { memberId: user.id },
          { memberId: gpt4o.id },
        ],
      },
      messages: {
        create: [
          {
            content: { text: "Conversation created with the following members: User, gpt-4o" },
            type: MessageType.SYSTEM,
          }
        ]
      }
    },
    include: {
      members: true,
      messages: true,
    },
  });

  console.log(`Created new chat: ${chat1.id}`);
  console.log(`Added ${chat1.members.length} members to the chat`);
  console.log(`Added ${chat1.messages.length} message(s) to the chat`);

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
